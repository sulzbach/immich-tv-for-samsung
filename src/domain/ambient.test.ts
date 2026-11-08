import { describe, expect, it } from "vitest";
import {
  ambientOrderApplies,
  defaultAmbientSettings,
  normalizeAmbientSettings,
  readAmbientOrder
} from "./ambient";

describe("ambient settings", () => {
  it("defaults to shuffled photos from everything, a clock, every 30 seconds, never stopping", () => {
    expect(normalizeAmbientSettings(null)).toEqual(defaultAmbientSettings);
    expect(defaultAmbientSettings).toMatchObject({
      includeVideos: false,
      intervalSeconds: 30,
      order: "shuffle",
      showClock: true,
      showDetails: false,
      source: "all",
      startAfterIdleMinutes: 0,
      stopAfterHours: 0,
      videoSound: false
    });
  });

  it("plays video sound only when it was turned on", () => {
    expect(normalizeAmbientSettings({ videoSound: true }).videoSound).toBe(true);
    expect(normalizeAmbientSettings({ videoSound: "yes" }).videoSound).toBe(false);
    // Settings saved before the option existed stay muted.
    expect(normalizeAmbientSettings({ includeVideos: true }).videoSound).toBe(false);
  });

  it("offers In order only for an album and Memories", () => {
    expect(["all", "favorites", "recent"].map((s) => ambientOrderApplies(s as never))).toEqual([
      false,
      false,
      false
    ]);
    expect(ambientOrderApplies("album")).toBe(true);
    expect(ambientOrderApplies("memories")).toBe(true);
    expect(readAmbientOrder({ ...defaultAmbientSettings, order: "in-order" })).toBe("shuffle");
    expect(
      readAmbientOrder({ ...defaultAmbientSettings, order: "in-order", source: "memories" })
    ).toBe("in-order");
  });

  it("keeps a valid album and every offered option", () => {
    expect(
      normalizeAmbientSettings({
        album: { id: "a1", name: "Summer Example" },
        intervalSeconds: 300,
        source: "album",
        startAfterIdleMinutes: 30,
        stopAfterHours: 4
      })
    ).toMatchObject({
      album: { id: "a1", name: "Summer Example" },
      intervalSeconds: 300,
      source: "album",
      startAfterIdleMinutes: 30,
      stopAfterHours: 4
    });
  });
});
