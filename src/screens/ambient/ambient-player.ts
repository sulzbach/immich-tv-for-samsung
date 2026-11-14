import type { AlbumService } from "../../app/album-service";
import type { AmbientAssetSource } from "../../app/ambient-sources";
import type { AlbumAsset } from "../../domain/album";
import {
  createAssetViewerImageState,
  reconcileAssetViewerImages,
  revokeAllAssetViewerImages,
  type AssetViewerImageState
} from "../asset-viewer-window";
import { clearStill, releaseVideo, showStill } from "../media-elements";
import type { AmbientTimers } from "./ambient-timers";

// Ambient mode's pictures (ADR 0019), built on the viewer's media path: the
// bounded viewer image window loads and revokes previews, and
// media-elements.ts shows and releases them. A playlist of at most three
// assets (the outgoing one while it fades, the current one and the next,
// preloaded) feeds two image layers that crossfade by opacity alone.
//
// The incoming layer fades in on top (data-incoming) while the outgoing
// picture, or a video paused on its last frame, stays fully opaque beneath
// it. Fading both at once would let the black background show through
// mid-fade (two half-transparent layers cover only three quarters), which
// reads on the TV as a black frame between pictures. The outgoing picture
// and the video are released, and the URL revoked, only once the fade ends.

export const ambientFadeMs = 1500;
// How long past its length a fade may run before it is taken as done, in
// case the browser never reports its end.
export const ambientFadeGraceMs = 1000;
// The longest a video plays before ambient mode moves on.
export const ambientVideoCapMs = 60000;
// A Live Photo's motion freezes this long before its end, so its last
// frames, which can show black on the TV, never do. The end is timed from
// the motion's length: timeupdate fires only every 250 ms or so, too seldom
// to catch it.
export const ambientMotionEndMarginMs = 300;
// How long a Live Photo's motion may take to show its first frame before the
// photo fades in as usual instead.
export const ambientMotionStartWaitMs = 4000;
// Of that, how long a motion still downloading may be waited for before it
// is streamed instead.
export const ambientMotionDownloadWaitMs = 2000;
// Failed pictures skipped in a row before ambient mode treats the source as
// failing.
export const ambientMaxConsecutiveSkips = 5;
// Retries after a failure wait this long, doubling up to the cap.
export const ambientBackoffStartMs = 15000;
export const ambientBackoffMaxMs = 300000;
// How long a picture may take to decode before it is shown anyway.
const decodeWaitMs = 5000;

export type AmbientPlayerState =
  { kind: "playing" } | { kind: "empty" } | { error: unknown; kind: "error" };

export type AmbientPlayerElements = {
  layers: [HTMLImageElement, HTMLImageElement];
  video: HTMLVideoElement;
};

type AmbientPlayerOptions = {
  elements: AmbientPlayerElements;
  intervalMs: number;
  // A Live Photo plays its motion once over its still (Settings > Ambient).
  livePhotoMotion: boolean;
  // ...with its sound; muted otherwise.
  livePhotoSound: boolean;
  // A picture is now showing (for its details).
  onShow(asset: AlbumAsset): void;
  onState(state: AmbientPlayerState): void;
  service: Pick<
    AlbumService,
    | "loadAssetPlaybackUrl"
    | "loadAssetViewerStillUrl"
    | "loadLivePhotoMotionUrl"
    | "revokeImageUrl"
    | "revokeMotionUrl"
  >;
  source: AmbientAssetSource;
  timers: AmbientTimers;
  // Videos play with their sound (Settings > Ambient); muted otherwise.
  videoSound: boolean;
};

export type AmbientPlayer = {
  // The number of preview URLs currently held.
  heldUrlCount(): number;
  start(): void;
  // Releases every picture, video, URL and timer.
  stop(): void;
};

export function createAmbientPlayer(options: AmbientPlayerOptions): AmbientPlayer {
  const { elements, service, source, timers } = options;
  let generation = 0;
  let running = false;
  let playlist: AlbumAsset[] = [];
  let currentIndex = 0;
  let front = 0;
  let images: AssetViewerImageState = createAssetViewerImageState();
  let showingFirst = true;
  let advanceDue = false;
  let advancing = false;
  let fetchingNext = false;
  let skips = 0;
  let backoffMs = ambientBackoffStartMs;
  let dwellTimer: number | null = null;
  let playingVideo = false;
  // A Live Photo's motion is playing over its still.
  let playingMotion = false;
  let motionEndTimer: number | null = null;
  // Whether the motion plays with its sound, re-applied once the TV has
  // started it.
  let motionSound = false;
  // Called once the motion shows its first frame.
  let onMotionShown: (() => void) | null = null;
  // A Live Photo's motion has ended, frozen on its last frame, and holds the
  // video element until the next picture covers it.
  let frozenMotion = false;
  // The Live Photo whose motion a cut already tried, so it isn't tried again
  // over its still.
  let motionTriedId: string | null = null;
  // Live Photo motion downloaded ahead, by asset, for the playlist's assets
  // only (at most three), so it plays from memory without waiting on the
  // network. Released as its asset leaves the playlist.
  let motions: Record<string, PreloadedMotion> = {};

  const isCurrent = (expected: number) => running && expected === generation;
  const current = () => playlist[currentIndex];
  const next = () => playlist[currentIndex + 1];
  const layer = (index: number) => elements.layers[index]!;

  function reconcile(): void {
    const expected = generation;

    reconcileAssetViewerImages({
      assets: playlist,
      currentIndex,
      generation,
      isCurrentGeneration: (requestGeneration) =>
        isCurrent(expected) && requestGeneration === generation,
      isHidden: () => !running,
      loadImageUrl: (asset) => service.loadAssetViewerStillUrl(asset),
      onImageLoadFailed: (asset) => handleFailure(asset),
      onImageLoaded: (asset) => handleLoaded(asset),
      revokeImageUrl: service.revokeImageUrl,
      state: images
    });
    reconcileMotions();
  }

  // Downloads the motion of each Live Photo in the playlist that lacks one,
  // and releases the motion of any asset no longer in it.
  function reconcileMotions(): void {
    const ids = playlist.map((asset) => asset.id);

    Object.keys(motions).forEach((id) => {
      if (ids.indexOf(id) < 0) {
        releaseMotion(id);
      }
    });

    if (!options.livePhotoMotion) {
      return;
    }

    playlist.forEach((asset) => {
      if (playsMotion(asset) && !motions[asset.id]) {
        preloadMotion(asset);
      }
    });
  }

  function preloadMotion(asset: AlbumAsset): void {
    const entry: PreloadedMotion = {
      ready: Promise.resolve(null),
      released: false,
      url: null
    };

    entry.ready = service.loadLivePhotoMotionUrl(asset).then(
      (url) => {
        if (url && entry.released) {
          service.revokeMotionUrl(url);
          return null;
        }

        entry.url = url;
        return url;
      },
      // A motion that can't be downloaded is streamed instead.
      () => null
    );
    motions[asset.id] = entry;
  }

  function releaseMotion(id: string): void {
    const entry = motions[id];

    if (!entry) {
      return;
    }

    delete motions[id];
    entry.released = true;

    if (entry.url) {
      service.revokeMotionUrl(entry.url);
      entry.url = null;
    }
  }

  // The downloaded motion's URL, waiting at most `waitMs` for a download in
  // progress; null when there is none in time.
  function preloadedMotion(asset: AlbumAsset, waitMs: number): Promise<string | null> {
    const entry = motions[asset.id];

    if (!entry) {
      return Promise.resolve(null);
    }

    if (entry.url) {
      return Promise.resolve(entry.url);
    }

    return new Promise((resolve) => {
      const timer = timers.set(() => resolve(null), waitMs);

      void entry.ready.then((url) => {
        timers.clear(timer);
        resolve(url);
      });
    });
  }

  function handleLoaded(asset: AlbumAsset): void {
    if (showingFirst && current()?.id === asset.id) {
      void present(asset);
    } else if (advanceDue && next()?.id === asset.id) {
      void advance();
    }
  }

  function handleFailure(asset: AlbumAsset): void {
    skips += 1;

    const index = playlist.indexOf(asset);

    if (index >= 0 && (index !== currentIndex || showingFirst)) {
      playlist.splice(index, 1);
    }

    if (skips >= ambientMaxConsecutiveSkips) {
      fail(new Error("Ambient pictures keep failing to load."));
      return;
    }

    if (showingFirst) {
      void fetchFirst();
    } else {
      void fetchNext();
    }
  }

  async function fetchFirst(): Promise<void> {
    const expected = generation;
    let asset: AlbumAsset | null;

    try {
      asset = await source.next();
    } catch (error) {
      if (isCurrent(expected)) {
        fail(error);
      }
      return;
    }

    if (!isCurrent(expected)) {
      return;
    }

    if (!asset) {
      options.onState({ kind: "empty" });
      return;
    }

    playlist = [asset];
    currentIndex = 0;
    showingFirst = true;
    reconcile();
  }

  async function fetchNext(): Promise<void> {
    if (fetchingNext || next()) {
      return;
    }

    const expected = generation;

    fetchingNext = true;

    try {
      const asset = await source.next();

      if (!isCurrent(expected)) {
        return;
      }

      fetchingNext = false;

      // A source that has become empty keeps showing what is on screen.
      if (asset) {
        playlist.push(asset);
        reconcile();
      }
    } catch (error) {
      if (isCurrent(expected)) {
        fetchingNext = false;
        fail(error);
      }
    }
  }

  async function present(asset: AlbumAsset): Promise<void> {
    const expected = generation;
    const url = images.imageUrls[asset.id];

    if (!url) {
      return;
    }

    showingFirst = false;
    showStill(layer(front), asset, url);
    await waitForDecode(layer(front), timers);

    if (!isCurrent(expected)) {
      return;
    }

    const first = layer(front);

    // A Live Photo with motion on starts with its motion, not a fade.
    if (playsMotion(asset) && (await startMotion(asset))) {
      if (!isCurrent(expected)) {
        return;
      }

      first.setAttribute("data-visible", "true");
      shown(asset);
      return;
    }

    if (!isCurrent(expected)) {
      return;
    }

    // As for every later picture, its details change once it is fully shown:
    // shown with the fade's start, they appeared over black before the
    // picture did.
    void fadeIn(first, timers).then(() => {
      if (isCurrent(expected)) {
        first.removeAttribute("data-incoming");
        options.onShow(asset);
      }
    });
    shown(asset, false);
  }

  function playsMotion(asset: AlbumAsset): boolean {
    return options.livePhotoMotion && asset.type === "image" && Boolean(asset.livePhotoVideoId);
  }

  // Plays the motion and resolves once it shows its first frame (true), or
  // when it can't, in time (false, with the motion released).
  async function startMotion(asset: AlbumAsset): Promise<boolean> {
    const expected = generation;
    const deadline = Date.now() + ambientMotionStartWaitMs;

    motionTriedId = asset.id;

    const downloaded = await preloadedMotion(asset, ambientMotionDownloadWaitMs);

    if (!isCurrent(expected)) {
      return false;
    }

    return new Promise((resolve) => {
      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        timers.clear(timer);
        onMotionShown = null;

        if (!ok && playingMotion) {
          stopVideo();
        }

        resolve(ok);
      };
      const timer = timers.set(() => settle(false), Math.max(0, deadline - Date.now()));

      onMotionShown = () => settle(true);

      if (!playMotion(asset, downloaded, () => settle(false))) {
        settle(false);
      }
    });
  }

  // `details`: tell the screen which picture shows (for its details) now,
  // or leave that to the caller.
  function shown(asset: AlbumAsset, details = true): void {
    skips = 0;
    backoffMs = ambientBackoffStartMs;

    if (details) {
      options.onShow(asset);
    }

    options.onState({ kind: "playing" });
    dwell(asset);
    void fetchNext();
  }

  // How long the current asset stays: the interval, or a video's length up
  // to the cap.
  function dwell(asset: AlbumAsset): void {
    if (asset.type === "video" && playVideo(asset)) {
      dwellTimer = timers.set(endDwell, ambientVideoCapMs);
      return;
    }

    dwellTimer = timers.set(endDwell, options.intervalMs);

    // A cut to the motion has already played it, or given up on it.
    if (playsMotion(asset) && motionTriedId !== asset.id) {
      playMotion(asset, motions[asset.id]?.url || null);
    }
  }

  // Plays a Live Photo's motion once over its still, which stays in view
  // until the motion has a frame to show (as in the viewer, ADR 0005). The
  // interval runs as for any photo; the still comes back before the motion
  // ends.
  // Plays the motion from `downloaded` when it was downloaded ahead, or
  // streams it; a downloaded motion the TV won't play is streamed instead.
  function playMotion(
    asset: AlbumAsset,
    downloaded: string | null,
    onFailed: () => void = () => undefined
  ): boolean {
    const streamed = service.loadAssetPlaybackUrl(asset);
    const url = downloaded || streamed;

    if (!url) {
      return false;
    }

    const video = elements.video;
    const stillPlaying = () => playingMotion && video.getAttribute("src") === url;

    motionSound = options.livePhotoSound;
    setSound(video, motionSound);
    video.loop = false;
    video.style.opacity = "0";
    video.addEventListener("timeupdate", handleMotionProgress);
    video.addEventListener("loadedmetadata", applyMotionSound);
    video.addEventListener("playing", applyMotionSound);
    video.src = url;
    video.hidden = false;
    playingMotion = true;
    video
      .play()
      .catch(() => {
        // A TV that won't start it with sound on its own may start it muted.
        if (!stillPlaying() || video.muted) {
          throw new Error("Motion could not play.");
        }

        motionSound = false;
        setSound(video, false);
        return video.play();
      })
      .catch(() => {
        if (!stillPlaying()) {
          return;
        }

        stopVideo();

        if (downloaded && streamed && playMotion(asset, null, onFailed)) {
          return;
        }

        // Motion that cannot play leaves the still, as with motion off.
        onFailed();
      });

    return true;
  }

  // On the TV, the player set its own volume once it started the video, and
  // a Live Photo was heard with the motion muted: the choice is applied
  // again then.
  function applyMotionSound(): void {
    if (playingMotion) {
      setSound(elements.video, motionSound);
    }
  }

  function handleMotionProgress(): void {
    const video = elements.video;
    const time = video.currentTime;
    const duration = video.duration;

    if (!playingMotion || !(time > 0)) {
      return;
    }

    video.style.opacity = "1";

    if (onMotionShown) {
      onMotionShown();
    }

    if (!(duration > 0) || !isFinite(duration)) {
      return;
    }

    const remainingMs = (duration - time) * 1000 - ambientMotionEndMarginMs;

    if (remainingMs <= 0) {
      freezeMotion();
    } else if (motionEndTimer === null) {
      motionEndTimer = timers.set(freezeMotion, remainingMs);
    }
  }

  // Ends the motion on its last frame, which stays until the next picture
  // fades in over it (as a video's does). Going back to the still read as a
  // jump: a Live Photo's still is taken from the middle of its motion.
  function freezeMotion(): void {
    if (!playingMotion) {
      return;
    }

    const video = elements.video;

    clearMotionTimer();
    playingMotion = false;
    frozenMotion = true;
    video.removeEventListener("timeupdate", handleMotionProgress);
    video.pause();
  }

  function clearMotionTimer(): void {
    if (motionEndTimer !== null) {
      timers.clear(motionEndTimer);
      motionEndTimer = null;
    }
  }

  function endDwell(): void {
    if (dwellTimer !== null) {
      timers.clear(dwellTimer);
      dwellTimer = null;
    }

    advanceDue = true;
    void advance();
  }

  function playVideo(asset: AlbumAsset): boolean {
    const url = service.loadAssetPlaybackUrl(asset);

    if (!url) {
      return false;
    }

    const video = elements.video;

    const stillPlaying = () => playingVideo && current()?.id === asset.id;

    video.muted = !options.videoSound;
    // The video stays transparent over its poster until it is showing
    // frames: shown at once, it was black, or a jump from the poster, while
    // the TV started its decoder and the first data arrived.
    video.setAttribute("data-waiting", "true");
    video.addEventListener("timeupdate", revealVideo);
    video.src = url;
    video.hidden = false;
    playingVideo = true;
    video
      .play()
      .catch(() => {
        // A browser that won't start a video with sound on its own may
        // still start it muted.
        if (!stillPlaying() || video.muted) {
          throw new Error("Video could not play.");
        }

        video.muted = true;
        return video.play();
      })
      .catch(() => {
        // A video that cannot play keeps its poster for the usual interval.
        if (stillPlaying()) {
          stopVideo();
        }
      });

    return true;
  }

  // Shows the video once its playback has moved past the start, so a frame
  // is ready to replace the poster.
  function revealVideo(): void {
    const video = elements.video;

    if (playingVideo && video.currentTime > 0) {
      video.removeEventListener("timeupdate", revealVideo);
      video.removeAttribute("data-waiting");
    }
  }

  function stopVideo(): void {
    playingVideo = false;
    playingMotion = false;
    frozenMotion = false;
    clearMotionTimer();
    onMotionShown = null;
    elements.video.removeEventListener("timeupdate", handleMotionProgress);
    elements.video.removeEventListener("loadedmetadata", applyMotionSound);
    elements.video.removeEventListener("playing", applyMotionSound);
    elements.video.removeEventListener("timeupdate", revealVideo);
    elements.video.removeAttribute("data-waiting");
    releaseVideo(elements.video);
    // A muted Live Photo leaves the volume at 0; the next video starts from
    // full volume.
    elements.video.volume = 1;
  }

  async function advance(): Promise<void> {
    const upcoming = next();
    const url = upcoming ? images.imageUrls[upcoming.id] : undefined;

    if (advancing || !advanceDue || !upcoming || !url) {
      if (!upcoming) {
        void fetchNext();
      }
      return;
    }

    const expected = generation;
    const back = 1 - front;

    advancing = true;
    advanceDue = false;
    showStill(layer(back), upcoming, url);
    await waitForDecode(layer(back), timers);

    if (!isCurrent(expected)) {
      return;
    }

    // A Live Photo with motion on cuts straight to its motion, over the
    // picture on screen, instead of fading its still in; the still is put
    // beneath it. A video or a frozen motion on screen needs the one video
    // element until it is covered, so then the still fades in as usual, and
    // the motion plays over it.
    if (playsMotion(upcoming) && !playingVideo && !playingMotion && !frozenMotion) {
      const started = await startMotion(upcoming);

      if (!isCurrent(expected)) {
        return;
      }

      if (started) {
        const outgoing = front;

        layer(outgoing).removeAttribute("data-incoming");
        layer(back).setAttribute("data-visible", "true");
        layer(outgoing).removeAttribute("data-visible");
        clearStill(layer(outgoing));
        front = back;
        playlist = playlist.slice(currentIndex + 1);
        currentIndex = 0;
        advancing = false;
        reconcile();
        shown(upcoming);
        return;
      }
    }

    // A video holds its last frame under the incoming picture, and is
    // released once the picture covers it.
    if (playingVideo) {
      elements.video.pause();
    }

    // If the picture beneath is still fading in (a video that ended at
    // once), it settles fully shown, under the new one.
    layer(front).removeAttribute("data-incoming");
    const outgoing = front;

    front = back;
    currentIndex += 1;
    // The outgoing picture is taken away only once the incoming one is fully
    // shown, as the browser reports it: on the TV a fade can start late, and
    // ending it on a timer cut it short with a visible jump.
    await fadeIn(layer(back), timers);

    if (!isCurrent(expected)) {
      return;
    }

    stopVideo();
    layer(outgoing).removeAttribute("data-visible");
    layer(front).removeAttribute("data-incoming");
    clearStill(layer(outgoing));
    playlist = playlist.slice(currentIndex);
    currentIndex = 0;
    advancing = false;
    reconcile();
    shown(upcoming);
  }

  function release(): void {
    generation += 1;
    timers.clearAll();
    dwellTimer = null;
    stopVideo();
    elements.layers.forEach((image) => {
      image.removeAttribute("data-visible");
      image.removeAttribute("data-incoming");
      clearStill(image);
    });
    revokeAllAssetViewerImages(images, service.revokeImageUrl);
    images = createAssetViewerImageState();
    playlist = [];
    currentIndex = 0;
    showingFirst = true;
    advanceDue = false;
    advancing = false;
    fetchingNext = false;
    motionTriedId = null;
    Object.keys(motions).forEach(releaseMotion);
    motions = {};
  }

  // Shows the failure over a dark screen and tries again after a capped
  // backoff, starting afresh when the server answers.
  function fail(error: unknown): void {
    const delay = backoffMs;

    release();
    options.onState({ error, kind: "error" });
    backoffMs = Math.min(backoffMs * 2, ambientBackoffMaxMs);
    timers.set(() => {
      if (running) {
        skips = 0;
        void fetchFirst();
      }
    }, delay);
  }

  const handleVideoEnded = () => {
    if (running && playingMotion) {
      freezeMotion();
    } else if (running && playingVideo) {
      endDwell();
    }
  };

  elements.video.addEventListener("ended", handleVideoEnded);

  return {
    heldUrlCount: () => Object.keys(images.imageUrls).length,
    start() {
      release();
      running = true;
      skips = 0;
      backoffMs = ambientBackoffStartMs;
      void fetchFirst();
    },
    stop() {
      running = false;
      release();
      elements.video.removeEventListener("ended", handleVideoEnded);
    }
  };
}

type PreloadedMotion = {
  ready: Promise<string | null>;
  // Its asset has left the playlist; a download still in progress is
  // released as soon as it finishes.
  released: boolean;
  url: string | null;
};

// The media element's audio tracks, where the engine has them (Samsung's
// video element guide lists audioTracks; Chromium 63 has no AudioTrackList).
type AudioTrackSwitches = { length: number; [index: number]: { enabled: boolean } };

// Sound on or off. Off mutes, sets the volume to 0 and, where the engine has
// audio tracks, turns the file's own audio track off: on the TV (Tizen 8.0)
// a Live Photo's motion, an iPhone .mov with PCM audio that Immich serves as
// it is, was heard although muted at volume 0. Audio tracks are listed only
// once the file's metadata has loaded, so this is applied again then.
function setSound(video: HTMLVideoElement, on: boolean): void {
  video.muted = !on;
  video.volume = on ? 1 : 0;

  const tracks = (video as HTMLVideoElement & { audioTracks?: AudioTrackSwitches }).audioTracks;

  if (!tracks) {
    return;
  }

  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];

    if (track) {
      track.enabled = on;
    }
  }
}

// Fades `image` in above everything else on the ambient screen, resolving
// when the fade has finished. The layer was hidden (display: none) until
// just now, so its transparent starting style is applied before it is made
// visible; otherwise the browser has no starting value to transition from
// and the picture appears at once. The browser's transitionend says when
// the fade is done; a fade that never reports (an interrupted transition)
// is taken as done a little after its length (ambientFadeGraceMs).
function fadeIn(image: HTMLImageElement, timers: AmbientTimers): Promise<void> {
  image.setAttribute("data-incoming", "true");
  void image.offsetWidth;
  image.setAttribute("data-visible", "true");

  return new Promise((resolve) => {
    const finish = () => {
      image.removeEventListener("transitionend", handleEnd);
      timers.clear(timer);
      resolve();
    };
    const handleEnd = (event: Event) => {
      if (event.target === image) {
        finish();
      }
    };
    const timer = timers.set(finish, ambientFadeMs + ambientFadeGraceMs);

    image.addEventListener("transitionend", handleEnd);
  });
}

// Waits for an image to load and decode, so the crossfade never shows a
// blank layer and doesn't stall while the TV decodes a large picture in its
// first frames, but never for long: a slow picture is shown as it is.
// HTMLImageElement.decode() arrived after Chromium 63 (Tizen 5.0), so those
// TVs wait for load alone, as before.
async function waitForDecode(image: HTMLImageElement, timers: AmbientTimers): Promise<void> {
  await waitForLoad(image, timers);

  const decodable = image as HTMLImageElement & { decode?: () => Promise<void> };

  if (typeof decodable.decode !== "function" || !(image.naturalWidth > 0)) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = timers.set(resolve, decodeWaitMs);
    const finish = () => {
      timers.clear(timer);
      resolve();
    };

    decodable.decode!().then(finish, finish);
  });
}

function waitForLoad(image: HTMLImageElement, timers: AmbientTimers): Promise<void> {
  if (image.complete && image.naturalWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const finish = () => {
      image.removeEventListener("load", finish);
      image.removeEventListener("error", finish);
      timers.clear(timer);
      resolve();
    };
    const timer = timers.set(finish, decodeWaitMs);

    image.addEventListener("load", finish);
    image.addEventListener("error", finish);
  });
}
