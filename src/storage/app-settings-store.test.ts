import { describe, expect, it } from "vitest";
import { defaultAmbientSettings } from "../domain/ambient";
import { defaultAppSettings } from "../domain/app-settings";
import { appSettingsSchemaVersion, createLocalAppSettingsStore } from "./app-settings-store";
import type { KeyValueStorage } from "./connection-settings-store";

function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  values: Record<string, string>;
} {
  return {
    values: { ...initial },
    getItem(key) {
      return this.values[key] || null;
    },
    setItem(key, value) {
      this.values[key] = value;
    }
  };
}

const allRailsOn = {
  albums: true,
  favorites: true,
  memories: true,
  people: true,
  "recently-added": true,
  "recently-viewed": true,
  videos: true
};

describe("app settings store", () => {
  it("loads default settings when storage is empty", () => {
    const store = createLocalAppSettingsStore(createMemoryStorage());

    expect(store.load()).toEqual({
      ambient: defaultAmbientSettings,
      autoplayVideos: false,
      highContrast: false,
      homeRails: allRailsOn,
      oledKeepAwake: false,
      playbackButtonsHide: 5,
      showFaceTags: false,
      showViewerDate: true,
      showViewerExif: true,
      showViewerTime: true,
      slideshowIntervalSeconds: 8,
      sortOrders: {
        favorites: "newest-first",
        people: "newest-first",
        photos: "newest-first",
        search: "newest-first",
        videos: "newest-first"
      },
      supporter: false
    });
  });

  it("loads default settings for malformed JSON", () => {
    const store = createLocalAppSettingsStore(
      createMemoryStorage({
        "immich-tv.app-settings": "{bad json"
      })
    );

    expect(store.load()).toEqual(defaultAppSettings);
  });

  it("saves and loads settings with the schema version", () => {
    const storage = createMemoryStorage();
    const store = createLocalAppSettingsStore(storage);
    const settings = {
      ambient: {
        album: { id: "album-1", name: "Summer Example" },
        includeVideos: true,
        intervalSeconds: 60,
        order: "in-order" as const,
        showClock: false,
        showDetails: true,
        source: "album" as const,
        startAfterIdleMinutes: 10,
        stopAfterHours: 2,
        videoSound: true
      },
      autoplayVideos: true,
      highContrast: true,
      homeRails: { ...allRailsOn, people: false },
      oledKeepAwake: true,
      playbackButtonsHide: "never" as const,
      showFaceTags: true,
      showViewerDate: false,
      showViewerExif: true,
      showViewerTime: false,
      slideshowIntervalSeconds: 12,
      sortOrders: { ...defaultAppSettings.sortOrders, photos: "oldest-first" as const },
      supporter: true
    };

    expect(store.save(settings)).toEqual(settings);
    expect(store.load()).toEqual(settings);
    expect(JSON.parse(storage.values["immich-tv.app-settings"]!).schemaVersion).toBe(
      appSettingsSchemaVersion
    );
  });

  it("migrates unversioned settings, defaulting newer settings", () => {
    const store = createLocalAppSettingsStore(
      createMemoryStorage({
        "immich-tv.app-settings": JSON.stringify({
          autoplayVideos: true
        })
      })
    );

    expect(store.load()).toEqual({
      ambient: defaultAmbientSettings,
      autoplayVideos: true,
      highContrast: false,
      homeRails: allRailsOn,
      oledKeepAwake: false,
      playbackButtonsHide: 5,
      showFaceTags: false,
      showViewerDate: true,
      showViewerExif: true,
      showViewerTime: true,
      slideshowIntervalSeconds: 8,
      sortOrders: {
        favorites: "newest-first",
        people: "newest-first",
        photos: "newest-first",
        search: "newest-first",
        videos: "newest-first"
      },
      supporter: false
    });
  });

  it("migrates version 1 settings with ambient mode's defaults", () => {
    const store = createLocalAppSettingsStore(
      createMemoryStorage({
        "immich-tv.app-settings": JSON.stringify({
          autoplayVideos: true,
          schemaVersion: 1,
          slideshowIntervalSeconds: 12
        })
      })
    );

    expect(store.load()).toEqual({
      ...defaultAppSettings,
      ambient: defaultAmbientSettings,
      autoplayVideos: true,
      slideshowIntervalSeconds: 12
    });
  });

  it("migrates version 2 settings to version 3 with high contrast off", () => {
    // Version 2 had every current setting except High contrast.
    const version2: Partial<typeof defaultAppSettings> = { ...defaultAppSettings };
    delete version2.highContrast;
    const store = createLocalAppSettingsStore(
      createMemoryStorage({
        "immich-tv.app-settings": JSON.stringify({
          ...version2,
          autoplayVideos: true,
          schemaVersion: 2
        })
      })
    );

    expect(store.load()).toEqual({ ...defaultAppSettings, autoplayVideos: true });
  });

  it("migrates version 3 settings to version 4 with the buttons fading after 5 seconds", () => {
    const version3: Partial<typeof defaultAppSettings> = { ...defaultAppSettings };
    delete version3.playbackButtonsHide;
    const store = createLocalAppSettingsStore(
      createMemoryStorage({
        "immich-tv.app-settings": JSON.stringify({
          ...version3,
          highContrast: true,
          schemaVersion: 3
        })
      })
    );

    expect(store.load()).toEqual({ ...defaultAppSettings, highContrast: true });
    expect(store.load().playbackButtonsHide).toBe(5);
  });

  it("migrates version 4 settings unchanged, with the supporter toggle off", () => {
    // Version 4 had every current setting except the supporter toggle and the
    // OLED keep-awake.
    const version4: Partial<typeof defaultAppSettings> = {
      ...defaultAppSettings,
      autoplayVideos: true,
      highContrast: true,
      playbackButtonsHide: 10,
      slideshowIntervalSeconds: 20
    };
    delete version4.supporter;
    delete version4.oledKeepAwake;
    const storage = createMemoryStorage({
      "immich-tv.app-settings": JSON.stringify({ ...version4, schemaVersion: 4 })
    });
    const store = createLocalAppSettingsStore(storage);

    expect(store.load()).toEqual({ ...version4, oledKeepAwake: false, supporter: false });

    store.save({ ...store.load(), supporter: true });

    expect(JSON.parse(storage.values["immich-tv.app-settings"]!)).toMatchObject({
      schemaVersion: appSettingsSchemaVersion,
      supporter: true
    });
    expect(store.load()).toEqual({ ...version4, oledKeepAwake: false, supporter: true });
  });

  it("migrates version 5 settings to version 6 unchanged, with the OLED keep-awake off", () => {
    // Version 5 had every current setting except the OLED keep-awake.
    const version5: Partial<typeof defaultAppSettings> = {
      ...defaultAppSettings,
      ambient: { ...defaultAppSettings.ambient, includeVideos: true },
      autoplayVideos: true,
      supporter: true
    };
    delete version5.oledKeepAwake;
    const storage = createMemoryStorage({
      "immich-tv.app-settings": JSON.stringify({ ...version5, schemaVersion: 5 })
    });
    const store = createLocalAppSettingsStore(storage);

    expect(appSettingsSchemaVersion).toBe(6);
    expect(store.load()).toEqual({ ...version5, oledKeepAwake: false });

    store.save({ ...store.load(), oledKeepAwake: true });

    expect(JSON.parse(storage.values["immich-tv.app-settings"]!)).toMatchObject({
      oledKeepAwake: true,
      schemaVersion: 6
    });
    expect(store.load()).toEqual({ ...version5, oledKeepAwake: true });
  });

  it("turns the OLED keep-awake on only when it was explicitly turned on", () => {
    const load = (value: unknown) =>
      createLocalAppSettingsStore(
        createMemoryStorage({
          "immich-tv.app-settings": JSON.stringify({ oledKeepAwake: value, schemaVersion: 6 })
        })
      ).load().oledKeepAwake;

    expect([true, false, "true", 1, null].map(load)).toEqual([true, false, false, false, false]);
  });

  it("counts as a supporter only when the toggle was explicitly turned on", () => {
    const load = (value: unknown) =>
      createLocalAppSettingsStore(
        createMemoryStorage({
          "immich-tv.app-settings": JSON.stringify({ schemaVersion: 5, supporter: value })
        })
      ).load().supporter;

    expect([true, false, "true", 1, null].map(load)).toEqual([true, false, false, false, false]);
  });

  it("keeps each Hide playback buttons choice, and defaults anything else to 5 seconds", () => {
    const load = (value: unknown) =>
      createLocalAppSettingsStore(
        createMemoryStorage({
          "immich-tv.app-settings": JSON.stringify({ playbackButtonsHide: value, schemaVersion: 4 })
        })
      ).load().playbackButtonsHide;

    expect([3, 5, 10, 15, "never"].map(load)).toEqual([3, 5, 10, 15, "never"]);
    expect([4, 0, "5", null, "always"].map(load)).toEqual([5, 5, 5, 5, 5]);
  });

  it("keeps high contrast only when it was explicitly turned on", () => {
    const load = (value: unknown) =>
      createLocalAppSettingsStore(
        createMemoryStorage({
          "immich-tv.app-settings": JSON.stringify({ highContrast: value, schemaVersion: 3 })
        })
      ).load().highContrast;

    expect(load(true)).toBe(true);
    expect(load("yes")).toBe(false);
    expect(load(1)).toBe(false);
  });

  it("falls back safely from unknown ambient values", () => {
    const store = createLocalAppSettingsStore(
      createMemoryStorage({
        "immich-tv.app-settings": JSON.stringify({
          ambient: {
            album: { id: 7 },
            includeVideos: "yes",
            intervalSeconds: 45,
            order: "sideways",
            showClock: false,
            source: "everything",
            startAfterIdleMinutes: 5,
            stopAfterHours: 3
          },
          schemaVersion: 2
        })
      })
    );

    expect(store.load().ambient).toEqual({
      ...defaultAmbientSettings,
      showClock: false,
      startAfterIdleMinutes: 5
    });
  });

  it("drops unknown Home rails and turns on rails missing from storage", () => {
    const store = createLocalAppSettingsStore(
      createMemoryStorage({
        "immich-tv.app-settings": JSON.stringify({
          homeRails: { albums: false, retired: false, videos: "no" },
          schemaVersion: 1
        })
      })
    );

    expect(store.load().homeRails).toEqual({ ...allRailsOn, albums: false });
  });

  it("keeps only a chosen oldest-first order and defaults the rest to newest first", () => {
    const store = createLocalAppSettingsStore(
      createMemoryStorage({
        "immich-tv.app-settings": JSON.stringify({
          sortOrders: { albums: "oldest-first", people: "oldest-first", photos: "sideways" }
        })
      })
    );

    expect(store.load().sortOrders).toEqual({
      ...defaultAppSettings.sortOrders,
      people: "oldest-first"
    });
  });

  it("normalizes unsupported slideshow intervals to the safe default", () => {
    const store = createLocalAppSettingsStore(
      createMemoryStorage({
        "immich-tv.app-settings": JSON.stringify({
          slideshowIntervalSeconds: 1
        })
      })
    );

    expect(store.load()).toEqual(defaultAppSettings);
  });
});
