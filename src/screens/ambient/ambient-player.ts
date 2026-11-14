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
  // A picture is now showing (for its details).
  onShow(asset: AlbumAsset): void;
  onState(state: AmbientPlayerState): void;
  service: Pick<
    AlbumService,
    "loadAssetPlaybackUrl" | "loadAssetViewerStillUrl" | "revokeImageUrl"
  >;
  source: AmbientAssetSource;
  timers: AmbientTimers;
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

    void fadeIn(first, timers).then(() => {
      if (isCurrent(expected)) {
        first.removeAttribute("data-incoming");
      }
    });
    shown(asset);
  }

  function shown(asset: AlbumAsset): void {
    skips = 0;
    backoffMs = ambientBackoffStartMs;
    options.onShow(asset);
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

    video.muted = true;
    video.src = url;
    video.hidden = false;
    playingVideo = true;
    video.play().catch(() => {
      // A video that cannot play keeps its poster for the usual interval.
      if (playingVideo && current()?.id === asset.id) {
        stopVideo();
      }
    });

    return true;
  }

  function stopVideo(): void {
    playingVideo = false;
    releaseVideo(elements.video);
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
    if (running && playingVideo) {
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
