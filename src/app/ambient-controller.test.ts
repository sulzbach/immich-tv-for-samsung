// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAmbientSettings, type AmbientSettings } from "../domain/ambient";
import { createFakeLifecycle } from "../test/fake-lifecycle";
import {
  ambientCheckMs,
  createAmbientController,
  type AmbientController
} from "./ambient-controller";

let controller: AmbientController | null = null;

function setup(
  options: {
    canStart?: () => boolean;
    outcome?: "started" | "unavailable";
    settings?: Partial<AmbientSettings>;
  } = {}
) {
  document.body.innerHTML =
    '<button id="tile">Tile</button><div hidden><button id="gone">Gone</button></div>';
  const tile = document.getElementById("tile")!;
  tile.focus();
  let saved: AmbientSettings = { ...defaultAmbientSettings, ...options.settings };
  let active = false;
  const screen = {
    isActive: () => active,
    start: vi.fn(async () => {
      active = options.outcome !== "unavailable";
      return options.outcome || ("started" as const);
    }),
    stop: vi.fn(() => {
      active = false;
    })
  };
  const lifecycle = createFakeLifecycle();
  const onEnded = vi.fn();
  const onStarted = vi.fn();
  const createSource = vi.fn(() => ({ next: async () => null }));

  controller = createAmbientController({
    canStartFromIdle: options.canStart || (() => true),
    createSource,
    lifecycle,
    onEnded,
    onStarted,
    screen,
    settings: () => saved
  });

  return {
    createSource,
    lifecycle,
    onEnded,
    onStarted,
    press: () =>
      document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })),
    save(next: Partial<AmbientSettings>) {
      saved = { ...saved, ...next };
      controller!.refresh();
    },
    screen,
    tile
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  controller?.destroy();
  controller = null;
  vi.useRealTimers();
});

describe("ambient controller", () => {
  it("starts now with the given settings and returns to the same focus on exit", async () => {
    const f = setup();
    const chosen = { ...defaultAmbientSettings, source: "favorites" as const };

    controller!.startNow(chosen);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.screen.start).toHaveBeenCalledWith(
      expect.objectContaining({ quiet: false, settings: chosen })
    );
    expect(f.createSource).toHaveBeenCalledWith(chosen);
    expect(controller!.isActive()).toBe(true);

    controller!.exit();
    expect(f.screen.stop).toHaveBeenCalled();
    expect(document.activeElement).toBe(f.tile);
    expect(f.onEnded).toHaveBeenCalledWith(true);
  });

  it("starts after the idle time, restarted by any key, and quietly", async () => {
    const f = setup({ settings: { startAfterIdleMinutes: 5 } });

    await vi.advanceTimersByTimeAsync(4 * 60000);
    f.press();
    await vi.advanceTimersByTimeAsync(4 * 60000);
    expect(f.screen.start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.screen.start).toHaveBeenCalledWith(expect.objectContaining({ quiet: true }));
  });

  it("starts quietly with the saved settings when the TV was idle on its Home screen", async () => {
    const f = setup({ canStart: () => false, settings: { intervalSeconds: 60 } });

    // The app's own idle rule doesn't apply: the TV, not the app, was idle.
    controller!.startIdle();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.screen.start).toHaveBeenCalledWith(
      expect.objectContaining({
        quiet: true,
        settings: expect.objectContaining({ intervalSeconds: 60 })
      })
    );

    // Not again while it is showing.
    controller!.startIdle();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.screen.start).toHaveBeenCalledTimes(1);
  });

  it("never starts by itself when idle is off, or over a screen it must not cover", async () => {
    let allowed = false;
    const f = setup({ canStart: () => allowed, settings: { startAfterIdleMinutes: 5 } });

    await vi.advanceTimersByTimeAsync(30 * 60000);
    expect(f.screen.start).not.toHaveBeenCalled();
    allowed = true;
    await vi.advanceTimersByTimeAsync(5 * 60000);
    expect(f.screen.start).toHaveBeenCalledTimes(1);

    controller!.exit();
    f.save({ startAfterIdleMinutes: 0 });
    await vi.advanceTimersByTimeAsync(60 * 60000);
    expect(f.screen.start).toHaveBeenCalledTimes(1);
  });

  it("carries on as before when a quiet start finds nothing to show", async () => {
    const f = setup({ outcome: "unavailable", settings: { startAfterIdleMinutes: 5 } });

    await vi.advanceTimersByTimeAsync(5 * 60000);
    expect(f.screen.start).toHaveBeenCalledTimes(1);
    expect(controller!.isActive()).toBe(false);
    expect(document.activeElement).toBe(f.tile);
    // The idle timer starts again.
    await vi.advanceTimersByTimeAsync(5 * 60000);
    expect(f.screen.start).toHaveBeenCalledTimes(2);
  });

  it("ends after the Stop after time and returns where you were", async () => {
    const f = setup();

    controller!.startNow({ ...defaultAmbientSettings, stopAfterHours: 1 });
    await vi.advanceTimersByTimeAsync(60 * 60000 - 1);
    expect(controller!.isActive()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(controller!.isActive()).toBe(false);
    expect(f.screen.stop).toHaveBeenCalled();
    expect(document.activeElement).toBe(f.tile);
  });

  it("falls back when the focused control has gone", async () => {
    const f = setup();
    document.getElementById("gone")!.focus();
    controller!.startNow(defaultAmbientSettings);
    controller!.exit();

    expect(f.onEnded).toHaveBeenCalledWith(false);
  });

  it("stops when the app is hidden and resumes a manual start when shown", async () => {
    const f = setup();

    controller!.startNow({ ...defaultAmbientSettings, stopAfterHours: 2 });
    await vi.advanceTimersByTimeAsync(60 * 60000);
    f.lifecycle.setVisibility("hidden");
    expect(f.screen.stop).toHaveBeenCalledTimes(1);
    expect(controller!.isActive()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    f.lifecycle.setVisibility("visible");
    expect(f.screen.start).toHaveBeenCalledTimes(2);
    expect(controller!.isActive()).toBe(true);
    // Stop after keeps its original deadline.
    await vi.advanceTimersByTimeAsync(60 * 60000);
    expect(controller!.isActive()).toBe(false);
    expect(document.activeElement).toBe(f.tile);
  });

  it("returns to the previous screen when an idle start is hidden and shown", async () => {
    const f = setup({ settings: { startAfterIdleMinutes: 5 } });

    await vi.advanceTimersByTimeAsync(5 * 60000);
    expect(controller!.isActive()).toBe(true);
    f.lifecycle.setVisibility("hidden");
    f.lifecycle.setVisibility("visible");

    expect(f.screen.start).toHaveBeenCalledTimes(1);
    expect(controller!.isActive()).toBe(false);
    expect(f.onEnded).toHaveBeenCalledWith(true);
    expect(document.activeElement).toBe(f.tile);
  });

  it("never sets one long timer for idle or Stop after, and keeps to the wall clock", async () => {
    const delays: number[] = [];
    const realSetTimeout = window.setTimeout.bind(window);
    vi.spyOn(window, "setTimeout").mockImplementation(((handler: () => void, delay?: number) => {
      delays.push(delay ?? 0);
      return realSetTimeout(handler, delay);
    }) as typeof window.setTimeout);
    const f = setup({ settings: { startAfterIdleMinutes: 30 } });

    await vi.advanceTimersByTimeAsync(30 * 60000 - 1);
    expect(f.screen.start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.screen.start).toHaveBeenCalledTimes(1);
    controller!.exit();

    controller!.startNow({ ...defaultAmbientSettings, stopAfterHours: 4 });
    await vi.advanceTimersByTimeAsync(4 * 60 * 60000);
    expect(controller!.isActive()).toBe(false);
    expect(Math.max(...delays)).toBeLessThanOrEqual(ambientCheckMs);
  });

  it("starts on time even when a check runs late", async () => {
    const f = setup({ settings: { startAfterIdleMinutes: 10 } });

    // The clock jumps on without the checks in between (a slow or stalled
    // timer): the next check still sees that 10 minutes have passed.
    vi.setSystemTime(Date.now() + 10 * 60000);
    await vi.advanceTimersByTimeAsync(ambientCheckMs);
    expect(f.screen.start).toHaveBeenCalledTimes(1);
  });

  it("clears the idle timer while hidden", async () => {
    const f = setup({ settings: { startAfterIdleMinutes: 5 } });

    f.lifecycle.setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(60 * 60000);
    expect(f.screen.start).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
