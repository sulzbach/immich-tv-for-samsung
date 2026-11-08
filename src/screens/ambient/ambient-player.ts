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
// preloaded) feeds two image layers that crossfade by opacity alone. The
// outgoing picture is cleared and its URL revoked as soon as the fade ends.

export const ambientFadeMs = 1500;
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

    layer(front).setAttribute("data-visible", "true");
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

    const stillPlaying = () => playingVideo && current()?.id === asset.id;

    video.muted = !options.videoSound;
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

    stopVideo();
    layer(back).setAttribute("data-visible", "true");
    layer(front).removeAttribute("data-visible");
    const outgoing = front;

    front = back;
    currentIndex += 1;
    timers.set(() => {
      if (!isCurrent(expected)) {
        return;
      }

      clearStill(layer(outgoing));
      playlist = playlist.slice(currentIndex);
      currentIndex = 0;
      advancing = false;
      reconcile();
      shown(upcoming);
    }, ambientFadeMs);
  }

  function release(): void {
    generation += 1;
    timers.clearAll();
    dwellTimer = null;
    stopVideo();
    elements.layers.forEach((image) => {
      image.removeAttribute("data-visible");
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

// Waits for an image to decode, so the crossfade never shows a blank layer,
// but never for long: a slow decode is shown as it is.
function waitForDecode(image: HTMLImageElement, timers: AmbientTimers): Promise<void> {
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
