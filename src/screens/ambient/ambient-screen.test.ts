// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AmbientAssetSource } from "../../app/ambient-sources";
import type { AlbumAsset } from "../../domain/album";
import { defaultAmbientSettings, type AmbientSettings } from "../../domain/ambient";
import { AppError } from "../../errors/app-error";
import { createPassiveViewing } from "../../platform/tizen/screensaver";
import { byId, loadAppMarkup } from "../../test/app-markup";
import {
  ambientBackoffStartMs,
  ambientFadeGraceMs,
  ambientFadeMs,
  ambientMaxConsecutiveSkips,
  ambientVideoCapMs
} from "./ambient-player";
import {
  ambientOverlayMoveMs,
  mountAmbientScreen,
  type AmbientScreenController
} from "./ambient-screen";

function asset(id: string, overrides: Partial<AlbumAsset> = {}): AlbumAsset {
  return {
    capturedAt: "2024-06-01T10:00:00.000Z",
    durationMs: null,
    id,
    livePhotoVideoId: null,
    location: "Exampleton, Exampleland",
    name: `${id}.jpg`,
    type: "image",
    ...overrides
  };
}

let screen: AmbientScreenController | null = null;

function fixture(options: { failing?: (id: string) => boolean; noPassive?: boolean } = {}) {
  let created = 0;
  let revoked = 0;
  const live = new Set<string>();
  const setScreenSaver = vi.fn();
  const service = {
    loadAssetPlaybackUrl: vi.fn((item: AlbumAsset) => `https://immich.example/${item.id}.mp4`),
    loadAssetViewerStillUrl: vi.fn(async (item: AlbumAsset) => {
      if (options.failing?.(item.id)) {
        throw new Error("preview failed");
      }

      created += 1;
      const url = `blob:${item.id}#${created}`;
      live.add(url);
      return url;
    }),
    revokeImageUrl: vi.fn((url: string) => {
      revoked += 1;
      live.delete(url);
    })
  };
  const onExit = vi.fn();

  // Previews decode at once in these tests.
  ["ambient-layer-a", "ambient-layer-b"].forEach((id) => {
    Object.defineProperty(byId(id), "complete", { configurable: true, get: () => true });
    Object.defineProperty(byId(id), "naturalWidth", { configurable: true, get: () => 1600 });
  });
  const video = byId<HTMLVideoElement>("ambient-video");
  video.play = vi.fn(async () => undefined);
  video.pause = vi.fn();
  video.load = vi.fn();

  const keepAwake = { set: vi.fn() };

  screen = mountAmbientScreen({
    now: () => new Date(2026, 9, 26, 7, 5),
    onExit,
    passiveViewing: createPassiveViewing({
      keepAwake,
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      windowRef: { webapis: options.noPassive ? undefined : { appcommon: { setScreenSaver } } }
    }),
    service
  });

  const shownSources = () =>
    ["ambient-layer-a", "ambient-layer-b"]
      .map((id) => byId<HTMLImageElement>(id))
      .filter((image) => image.getAttribute("src"))
      .map((image) => (image.getAttribute("src") || "").split("#")[0]);
  const visible = () =>
    ["ambient-layer-a", "ambient-layer-b"]
      .map((id) => byId<HTMLImageElement>(id))
      .filter((image) => image.hasAttribute("data-visible"))
      .map((image) => (image.getAttribute("src") || "").split("#")[0]);
  // The layer fading in on top, if any.
  const incoming = () =>
    ["ambient-layer-a", "ambient-layer-b"]
      .map((id) => byId<HTMLImageElement>(id))
      .filter((image) => image.hasAttribute("data-incoming"))
      .map((image) => (image.getAttribute("src") || "").split("#")[0]);

  // The browser reports the end of the fade in progress.
  const endFade = async () => {
    ["ambient-layer-a", "ambient-layer-b"]
      .map((id) => byId<HTMLImageElement>(id))
      .filter((image) => image.hasAttribute("data-incoming"))
      .forEach((image) => image.dispatchEvent(new Event("transitionend")));
    await flush();
  };

  return {
    counts: () => ({ created, live: live.size, revoked }),
    endFade,
    incoming,
    onExit,
    // What the OLED keep-awake was asked for, in order.
    keepAwake: () => keepAwake.set.mock.calls.map(([active]) => active as boolean),
    screensaver: () => setScreenSaver.mock.calls.map(([state]) => state as number),
    service,
    shownSources,
    video,
    visible
  };
}

function sequenceSource(make: (index: number) => AlbumAsset | null = (i) => asset(`a${i}`)) {
  let index = 0;
  const source: AmbientAssetSource & { next: ReturnType<typeof vi.fn> } = {
    next: vi.fn(async () => make(index++))
  };

  return source;
}

const settings = (overrides: Partial<AmbientSettings> = {}): AmbientSettings => ({
  ...defaultAmbientSettings,
  intervalSeconds: 10,
  ...overrides
});

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  loadAppMarkup();
});

afterEach(() => {
  screen?.destroy();
  screen = null;
  vi.useRealTimers();
});

describe("ambient presentation", () => {
  it("shows the first picture, preloads the next, and crossfades at each interval", async () => {
    const f = fixture();
    await screen!.start({ quiet: false, settings: settings(), source: sequenceSource() });
    await flush();

    expect(byId("ambient-screen").hidden).toBe(false);
    expect(f.visible()).toEqual(["blob:a0"]);
    // The first picture fades in from black, then settles.
    expect(f.incoming()).toEqual(["blob:a0"]);
    expect(f.service.loadAssetViewerStillUrl).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a1" })
    );
    await f.endFade();
    expect(f.incoming()).toEqual([]);

    await vi.advanceTimersByTimeAsync(10000);
    // Fading: the incoming picture fades in on top while the outgoing one
    // stays fully shown beneath it, so black never shows through mid-fade.
    expect(f.shownSources()).toEqual(["blob:a0", "blob:a1"]);
    expect(f.visible()).toEqual(["blob:a0", "blob:a1"]);
    expect(f.incoming()).toEqual(["blob:a1"]);
    expect(f.counts().live).toBeLessThanOrEqual(3);

    await f.endFade();
    // The outgoing picture is released as soon as the fade ends.
    expect(f.visible()).toEqual(["blob:a1"]);
    expect(f.incoming()).toEqual([]);
    expect(f.shownSources()).toEqual(["blob:a1"]);
    expect(f.service.revokeImageUrl).toHaveBeenCalledWith(expect.stringContaining("blob:a0"));
    expect(f.counts().live).toBeLessThanOrEqual(2);
  });

  it("keeps the outgoing picture until the browser reports the fade has ended", async () => {
    const f = fixture();
    await screen!.start({ quiet: false, settings: settings(), source: sequenceSource() });
    await flush();
    await f.endFade();

    await vi.advanceTimersByTimeAsync(10000);
    // On the TV a fade can start late: its nominal length passing is not
    // enough to take the outgoing picture away.
    await vi.advanceTimersByTimeAsync(ambientFadeMs);
    expect(f.visible()).toEqual(["blob:a0", "blob:a1"]);
    expect(f.incoming()).toEqual(["blob:a1"]);

    // A fade that never reports its end still finishes, a little late.
    await vi.advanceTimersByTimeAsync(ambientFadeGraceMs);
    expect(f.visible()).toEqual(["blob:a1"]);
    expect(f.incoming()).toEqual([]);
  });

  it("starts a fade only once the incoming picture has decoded", async () => {
    const f = fixture();
    let decoded: () => void = () => undefined;
    await screen!.start({ quiet: false, settings: settings(), source: sequenceSource() });
    await flush();
    await f.endFade();
    ["ambient-layer-a", "ambient-layer-b"].forEach((id) => {
      byId<HTMLImageElement>(id).decode = () =>
        new Promise<void>((resolve) => {
          decoded = resolve;
        });
    });

    await vi.advanceTimersByTimeAsync(10000);
    expect(f.incoming()).toEqual([]);
    expect(f.visible()).toEqual(["blob:a0"]);

    decoded();
    await flush();
    expect(f.incoming()).toEqual(["blob:a1"]);
  });

  it("shows the clock and details, and moves them on their timer", async () => {
    fixture();
    await screen!.start({
      quiet: false,
      settings: settings({ showDetails: true }),
      source: sequenceSource()
    });
    await flush();

    expect(byId("ambient-clock").textContent).toBe("07:05");
    expect(byId("ambient-clock").hidden).toBe(false);
    expect(byId("ambient-details").textContent).toBe("1 Jun 2024 · Exampleton, Exampleland");
    expect(byId("ambient-overlay").getAttribute("data-position")).toBe("0");

    await vi.advanceTimersByTimeAsync(ambientOverlayMoveMs);
    expect(byId("ambient-overlay").getAttribute("data-position")).toBe("1");
    await vi.advanceTimersByTimeAsync(ambientOverlayMoveMs * 3);
    expect(byId("ambient-overlay").getAttribute("data-position")).toBe("0");
  });

  it("hides the clock and details when they are off", async () => {
    fixture();
    await screen!.start({
      quiet: false,
      settings: settings({ showClock: false }),
      source: sequenceSource()
    });
    await flush();

    expect(byId("ambient-clock").hidden).toBe(true);
    expect(byId("ambient-details").hidden).toBe(true);
  });

  it("plays a video muted for at most a minute, and moves on when it ends", async () => {
    const f = fixture();
    const source = sequenceSource((i) =>
      i === 0 ? asset("v", { durationMs: 300000, type: "video" }) : asset(`a${i}`)
    );
    await screen!.start({ quiet: false, settings: settings({ includeVideos: true }), source });
    await flush();

    expect(f.video.muted).toBe(true);
    expect(f.video.getAttribute("src")).toBe("https://immich.example/v.mp4");
    expect(f.video.hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(ambientVideoCapMs - 1);
    expect(f.visible()).toEqual(["blob:v"]);
    await vi.advanceTimersByTimeAsync(1);
    // The next picture fades in over the video, paused on its last frame.
    expect(f.incoming()).toEqual(["blob:a1"]);
    expect(f.video.hidden).toBe(false);
    expect(f.video.paused).toBe(true);
    expect(f.video.getAttribute("src")).toBe("https://immich.example/v.mp4");
    await f.endFade();
    // Covered, the video is released.
    expect(f.visible()).toEqual(["blob:a1"]);
    expect(f.video.hidden).toBe(true);
    expect(f.video.getAttribute("src")).toBeNull();
  });

  it("moves on when a video ends before the cap", async () => {
    const f = fixture();
    const source = sequenceSource((i) =>
      i === 0 ? asset("v", { durationMs: 3000, type: "video" }) : asset(`a${i}`)
    );
    await screen!.start({ quiet: false, settings: settings({ includeVideos: true }), source });
    await flush();

    f.video.dispatchEvent(new Event("ended"));
    await flush();
    expect(f.incoming()).toEqual(["blob:a1"]);
    await f.endFade();
    expect(f.visible()).toEqual(["blob:a1"]);
    expect(f.video.hidden).toBe(true);
  });

  it("shows a Live Photo's still without playing its motion", async () => {
    const f = fixture();
    await screen!.start({
      quiet: false,
      settings: settings(),
      source: sequenceSource((i) => asset(`l${i}`, { livePhotoVideoId: "motion" }))
    });
    await flush();

    expect(f.visible()).toEqual(["blob:l0"]);
    expect(f.service.loadAssetPlaybackUrl).not.toHaveBeenCalled();
    expect(f.video.hidden).toBe(true);
  });
});

describe("ambient errors", () => {
  it("skips a picture that fails to load", async () => {
    const f = fixture({ failing: (id) => id === "a1" });
    await screen!.start({ quiet: false, settings: settings(), source: sequenceSource() });
    await flush();
    await vi.advanceTimersByTimeAsync(10000);
    await f.endFade();

    expect(f.visible()).toEqual(["blob:a2"]);
    expect(byId("ambient-message").hidden).toBe(true);
  });

  it("treats repeated failures as an unreachable server, backs off, and resumes", async () => {
    let down = true;
    const f = fixture({ failing: () => down });
    await screen!.start({ quiet: false, settings: settings(), source: sequenceSource() });
    await flush();

    expect(f.service.loadAssetViewerStillUrl).toHaveBeenCalledTimes(ambientMaxConsecutiveSkips);
    expect(byId("ambient-message").textContent).toBe(
      "Can't reach your Immich server. Trying again…"
    );
    expect(f.shownSources()).toEqual([]);

    // Still down after the first wait; the next wait doubles.
    await vi.advanceTimersByTimeAsync(ambientBackoffStartMs);
    expect(byId("ambient-message").hidden).toBe(false);
    down = false;
    await vi.advanceTimersByTimeAsync(ambientBackoffStartMs * 2 - 1);
    expect(byId("ambient-message").hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(byId("ambient-message").hidden).toBe(true);
    expect(f.visible()).toHaveLength(1);
  });

  it("shows the same calm message when the source can't be reached", async () => {
    fixture();
    const source = {
      next: vi
        .fn()
        .mockRejectedValueOnce(new AppError("network", "offline"))
        .mockImplementation(async () => asset("a"))
    };
    await screen!.start({ quiet: false, settings: settings(), source });
    await flush();

    expect(byId("ambient-message").textContent).toBe(
      "Can't reach your Immich server. Trying again…"
    );
    await vi.advanceTimersByTimeAsync(ambientBackoffStartMs);
    expect(byId("ambient-message").hidden).toBe(true);
  });

  it("explains an empty source, and a quiet start never shows", async () => {
    fixture();
    await screen!.start({
      quiet: false,
      settings: settings({ source: "favorites" }),
      source: sequenceSource(() => null)
    });
    await flush();

    expect(byId("ambient-message").textContent).toBe(
      "Nothing to show from Favourites. You can change it in Settings → Ambient."
    );

    screen!.stop();
    const outcome = screen!.start({
      quiet: true,
      settings: settings(),
      source: sequenceSource(() => null)
    });
    await flush();
    await expect(outcome).resolves.toBe("unavailable");
    expect(byId("ambient-screen").hidden).toBe(true);
    expect(screen!.isActive()).toBe(false);
  });

  it("shows a quiet start only once the first picture is ready", async () => {
    const f = fixture();
    const outcome = screen!.start({ quiet: true, settings: settings(), source: sequenceSource() });

    expect(byId("ambient-screen").hidden).toBe(true);
    await flush();
    await expect(outcome).resolves.toBe("started");
    expect(byId("ambient-screen").hidden).toBe(false);
    expect(f.visible()).toEqual(["blob:a0"]);
  });
});

describe("leaving ambient mode", () => {
  it("exits on any key, which does nothing else", async () => {
    const f = fixture();
    const beneath = vi.fn();
    document.addEventListener("keydown", beneath);
    document.addEventListener("keyup", beneath);
    await screen!.start({ quiet: false, settings: settings(), source: sequenceSource() });
    await flush();

    const down = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" });
    document.body.dispatchEvent(down);
    document.body.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));

    expect(f.onExit).toHaveBeenCalledTimes(1);
    expect(down.defaultPrevented).toBe(true);
    expect(beneath).not.toHaveBeenCalled();
    document.removeEventListener("keydown", beneath);
    document.removeEventListener("keyup", beneath);
  });

  it("holds the TV screensaver off while shown and releases everything on stop", async () => {
    const f = fixture();
    await screen!.start({ quiet: false, settings: settings(), source: sequenceSource() });
    await flush();
    await vi.advanceTimersByTimeAsync(25000);

    expect(f.screensaver()).toEqual([0]);
    // Ambient mode holds as photos, so the OLED keep-awake is asked to play.
    expect(f.keepAwake()).toEqual([true]);
    screen!.stop();

    expect(f.screensaver()).toEqual([0, 1]);
    expect(f.keepAwake()).toEqual([true, false]);
    expect(byId("ambient-screen").hidden).toBe(true);
    expect(screen!.timerCount()).toBe(0);
    expect(f.counts().live).toBe(0);
    expect(f.shownSources()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("ambient mode over a long run", () => {
  it("stays bounded for 8 simulated hours and returns to baseline on exit", async () => {
    const f = fixture({ failing: (id) => id.endsWith("7") });
    const baselineListeners = vi.getTimerCount();
    await screen!.start({
      quiet: false,
      settings: settings({ includeVideos: true, showDetails: true }),
      source: sequenceSource((i) =>
        i % 11 === 5 ? asset(`v${i}`, { durationMs: 5000, type: "video" }) : asset(`a${i}`)
      )
    });
    await flush();

    let maxLive = 0;
    let maxTimers = 0;

    for (let minute = 0; minute < 8 * 60; minute += 1) {
      await vi.advanceTimersByTimeAsync(60000);
      maxLive = Math.max(maxLive, f.counts().live);
      maxTimers = Math.max(maxTimers, screen!.timerCount());
      expect(f.shownSources().length).toBeLessThanOrEqual(2);
    }

    expect(f.counts().created).toBeGreaterThan(1000);
    expect(maxLive).toBeLessThanOrEqual(3);
    expect(maxTimers).toBeLessThanOrEqual(5);

    screen!.stop();
    expect(f.counts().live).toBe(0);
    expect(f.counts().created).toBe(f.counts().revoked);
    expect(screen!.timerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(baselineListeners);
    // Eight simulated hours take under a second alone, but can pass the
    // default 5 s limit while the whole suite runs in parallel.
  }, 30000);
});
