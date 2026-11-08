// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionService } from "../app/connection-service";
import { defaultAppSettings, type AppSettings } from "../domain/app-settings";
import { remoteKeys } from "../platform/tizen/keys";
import { byId, loadAppMarkup, pressKey } from "../test/app-markup";
import { mountConnectionScreen, type ConnectionScreenController } from "./connection-screen";

const savedSettings = { apiKey: "test-key", serverUrl: "https://immich.example" };
let controller: ConnectionScreenController | null = null;
let restoreToggleAttribute: (() => void) | null = null;

// Chromium 63 has no Element.toggleAttribute (Chrome 69+). Remove it so any
// regression throws exactly as it would on the Q950R.
function removeChrome69ToggleAttribute(): void {
  const prototype = Element.prototype as unknown as Record<string, unknown>;
  const original = prototype.toggleAttribute;

  delete prototype.toggleAttribute;
  restoreToggleAttribute = () => {
    prototype.toggleAttribute = original;
  };
}

function mount(
  options: { settings?: typeof savedSettings | null; appSettings?: AppSettings } = {}
) {
  const service: ConnectionService = {
    load: vi.fn(() => (options.settings === undefined ? savedSettings : options.settings)),
    save: vi.fn((settings) => settings),
    test: vi
      .fn()
      .mockResolvedValue({ serverLabel: "Immich v2", userLabel: "Test User", versionWarning: null })
  };
  const settingsStore = {
    load: vi.fn(() => options.appSettings || defaultAppSettings),
    save: vi.fn((settings: AppSettings) => settings)
  };
  const onBack = vi.fn();
  const onSaved = vi.fn();
  const onReturnToShell = vi.fn();
  const onAppSettingsSaved = vi.fn();
  const onChooseAmbientAlbum = vi.fn();
  const onStartAmbient = vi.fn();

  controller = mountConnectionScreen({
    onAppSettingsSaved,
    onBack,
    onChooseAmbientAlbum,
    onReturnToShell,
    onSaved,
    onStartAmbient,
    service,
    settingsStore
  });

  return {
    onAppSettingsSaved,
    onBack,
    onChooseAmbientAlbum,
    onReturnToShell,
    onSaved,
    onStartAmbient,
    service,
    settingsStore
  };
}

function changeAutoplay(): void {
  const autoplay = byId<HTMLInputElement>("autoplay-videos");

  autoplay.checked = !autoplay.checked;
  autoplay.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  loadAppMarkup();
  // The shell reveals the app after the splash; Settings skips controls inside
  // hidden ancestors.
  byId("app-shell").hidden = false;
});

afterEach(() => {
  controller?.destroy();
  controller = null;
  restoreToggleAttribute?.();
  restoreToggleAttribute = null;
});

describe("Settings dirty state on Chromium 63", () => {
  // happy-dom itself uses toggleAttribute (for example for `hidden`), so it is
  // removed only for these dirty-state checks.
  beforeEach(() => {
    removeChrome69ToggleAttribute();
  });

  it("shows and clears the unsaved indicator without Element.toggleAttribute", () => {
    mount();
    controller!.show({ allowBack: true });
    const save = byId("settings-save");

    expect("toggleAttribute" in Element.prototype).toBe(false);
    expect(save.hasAttribute("data-dirty")).toBe(false);

    changeAutoplay();

    expect(save.hasAttribute("data-dirty")).toBe(true);
    expect(byId("settings-save-label").textContent).toBe("Save *");

    save.focus();
    pressKey(remoteKeys.enter);

    expect(save.hasAttribute("data-dirty")).toBe(false);
    expect(byId("settings-save-label").textContent).toBe("Save");
  });

  it("keeps the periodic dirty-state refresh running without throwing", () => {
    vi.useFakeTimers();
    try {
      mount();
      controller!.show({ allowBack: true });
      changeAutoplay();

      expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
      expect(byId("settings-save").hasAttribute("data-dirty")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Settings remote navigation and actions", () => {
  it("starts on the Connection section and opens panels with Right", () => {
    mount();
    controller!.show({ allowBack: true });

    expect(document.activeElement).toBe(byId("settings-section-connection"));
    expect(byId("settings-panel-connection").hidden).toBe(true);
    expect(byId<HTMLInputElement>("server-url").value).toBe("https://immich.example");

    pressKey(remoteKeys.right);
    expect(byId("settings-panel-connection").hidden).toBe(false);
    expect(document.activeElement).toBe(byId("server-url"));

    pressKey(remoteKeys.left);
    expect(byId("settings-panel-connection").hidden).toBe(true);
    expect(document.activeElement).toBe(byId("settings-section-connection"));

    pressKey(remoteKeys.down);
    expect(document.activeElement).toBe(byId("settings-section-display"));
    pressKey(remoteKeys.enter);
    expect(byId("settings-panel-display").hidden).toBe(false);
    expect(document.activeElement).toBe(byId("high-contrast"));
  });

  it("enables text entry only after OK and keeps the API key masked until shown", () => {
    mount();
    controller!.show({ allowBack: true });
    pressKey(remoteKeys.right);
    const serverUrl = byId<HTMLInputElement>("server-url");

    expect(serverUrl.readOnly).toBe(true);
    pressKey(remoteKeys.enter);
    expect(serverUrl.readOnly).toBe(false);
    expect(serverUrl.getAttribute("data-editing")).toBe("true");

    pressKey(remoteKeys.down);
    expect(serverUrl.readOnly).toBe(true);
    expect(document.activeElement).toBe(byId("api-key"));
    expect(byId<HTMLInputElement>("api-key").type).toBe("password");

    pressKey(remoteKeys.down);
    expect(document.activeElement).toBe(byId("api-key-visibility"));
    pressKey(remoteKeys.enter);
    expect(byId<HTMLInputElement>("api-key").type).toBe("text");
    expect(byId("api-key-visibility").textContent).toBe("Hide");
  });

  it("tests the connection without saving and reports the result", async () => {
    const { service } = mount();
    controller!.show({ allowBack: true });
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.up);
    expect(document.activeElement?.getAttribute("data-action")).toBe("test-connection");

    pressKey(remoteKeys.enter);
    expect(byId("connection-status").getAttribute("data-state")).toBe("pending");
    await vi.waitFor(() =>
      expect(byId("connection-status").textContent).toBe("Immich v2 found. Connected as Test User.")
    );
    expect(service.test).toHaveBeenCalledWith(savedSettings);
    expect(service.save).not.toHaveBeenCalled();
  });

  it("shows an older server's version warning after a successful test", async () => {
    const { service } = mount();
    vi.mocked(service.test).mockResolvedValueOnce({
      serverLabel: "Immich 3.1.0",
      userLabel: "Test User",
      versionWarning: "This server needs updating to Immich 3.2.0 or later."
    });
    controller!.show({ allowBack: true });
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.up);
    pressKey(remoteKeys.enter);

    await vi.waitFor(() =>
      expect(byId("connection-status").textContent).toBe(
        "Immich 3.1.0 found. Connected as Test User. This server needs updating to Immich 3.2.0 or later."
      )
    );
    expect(byId("connection-status").getAttribute("data-state")).toBe("warning");
  });

  it("explains an invalid server URL and a failed connection test", async () => {
    const { service } = mount();
    vi.mocked(service.test).mockRejectedValueOnce(new Error("offline"));
    controller!.show({ allowBack: true });
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.up);
    pressKey(remoteKeys.enter);
    await vi.waitFor(() =>
      expect(byId("connection-status").getAttribute("data-state")).toBe("error")
    );
    expect(byId("connection-status").textContent).toBe(
      "Something unexpected happened while checking Immich."
    );

    byId<HTMLInputElement>("server-url").value = "ftp://immich.example";
    pressKey(remoteKeys.enter);
    expect(byId("connection-status").textContent).toBe(
      "Server URL must start with http:// or https://."
    );
    expect(service.test).toHaveBeenCalledTimes(1);
  });

  it("saves connection and display settings together", () => {
    const { onSaved, service, settingsStore } = mount();
    controller!.show({ allowBack: true });
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.enter); // High contrast on.
    for (let step = 0; step < 6; step += 1) pressKey(remoteKeys.down);
    // Arriving only focuses the interval; OK opens its list on the current value.
    expect(document.activeElement).toBe(byId("slideshow-interval"));
    pressKey(remoteKeys.enter);
    expect(document.activeElement?.textContent).toBe("✓8 seconds");
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.enter);
    expect(document.activeElement).toBe(byId("slideshow-interval"));
    expect(byId("slideshow-interval").textContent).toContain("12 seconds");

    byId("settings-save").focus();
    pressKey(remoteKeys.enter);

    expect(service.save).toHaveBeenCalledWith(savedSettings);
    expect(settingsStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ highContrast: true, slideshowIntervalSeconds: 12 })
    );
    expect(byId("settings-summary").textContent).toBe("Settings saved.");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("turns the OLED keep-awake on from Display, below Autoplay videos, and saves it", () => {
    const { settingsStore } = mount();
    controller!.show({ allowBack: true });
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.down);
    expect(document.activeElement).toBe(byId("oled-keep-awake"));
    expect(byId<HTMLInputElement>("oled-keep-awake").checked).toBe(false);
    pressKey(remoteKeys.enter);
    expect(byId<HTMLInputElement>("oled-keep-awake").checked).toBe(true);

    byId("settings-save").focus();
    pressKey(remoteKeys.enter);
    expect(settingsStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ oledKeepAwake: true })
    );
  });

  it("turns ambient Include videos off and locks it while the OLED keep-awake is ticked", () => {
    const { settingsStore } = mount({
      appSettings: {
        ...defaultAppSettings,
        ambient: { ...defaultAppSettings.ambient, includeVideos: true }
      }
    });
    controller!.show({ allowBack: true });
    const includeVideos = byId<HTMLInputElement>("ambient-include-videos");
    const hint = byId("ambient-include-videos-hint");
    expect(includeVideos.checked).toBe(true);

    byId("oled-keep-awake").focus();
    pressKey(remoteKeys.enter);
    expect(includeVideos.checked).toBe(false);
    expect(includeVideos.getAttribute("aria-disabled")).toBe("true");
    expect(hint.textContent).toBe("Off while Keep OLED screensaver away is on, in Display.");

    // Still reachable, but neither Enter nor a click ticks it.
    includeVideos.focus();
    pressKey(remoteKeys.enter);
    includeVideos.click();
    expect(includeVideos.checked).toBe(false);

    // Unticking the keep-awake before saving brings the choice back.
    byId("oled-keep-awake").focus();
    pressKey(remoteKeys.enter);
    expect(includeVideos.checked).toBe(true);
    expect(includeVideos.hasAttribute("aria-disabled")).toBe(false);
    expect(hint.textContent).toBe("Videos play for up to a minute each.");

    pressKey(remoteKeys.enter);
    byId("settings-save").focus();
    pressKey(remoteKeys.enter);
    expect(settingsStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        ambient: expect.objectContaining({ includeVideos: false }),
        oledKeepAwake: true
      })
    );
  });

  it("shows Include videos locked when the OLED keep-awake was saved on", () => {
    mount({
      appSettings: {
        ...defaultAppSettings,
        ambient: { ...defaultAppSettings.ambient, includeVideos: true },
        oledKeepAwake: true
      }
    });
    controller!.show({ allowBack: true });
    const includeVideos = byId<HTMLInputElement>("ambient-include-videos");

    expect(includeVideos.checked).toBe(false);
    expect(includeVideos.getAttribute("aria-disabled")).toBe("true");
  });

  it("chooses when the playback buttons fade, defaulting to 5 seconds, and saves Never", () => {
    const { settingsStore } = mount();
    controller!.show({ allowBack: true });
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.right);
    for (let step = 0; step < 7; step += 1) pressKey(remoteKeys.down);
    expect(document.activeElement).toBe(byId("playback-buttons-hide"));
    expect(byId("playback-buttons-hide").textContent).toContain("After 5 seconds");

    pressKey(remoteKeys.enter);
    expect(document.activeElement?.textContent).toBe("✓After 5 seconds");
    for (let step = 0; step < 3; step += 1) pressKey(remoteKeys.down);
    expect(document.activeElement?.textContent).toBe("Never");
    pressKey(remoteKeys.enter);

    byId("settings-save").focus();
    pressKey(remoteKeys.enter);
    expect(settingsStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ playbackButtonsHide: "never" })
    );
  });

  it("opens the slideshow interval with OK, like Search's drop-downs, and never traps focus", () => {
    const { settingsStore } = mount();
    const interval = () => byId("slideshow-interval");
    const list = () => byId("settings-panel-display").querySelector(".dropdown-list");
    controller!.show({ allowBack: true });
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.right);
    for (let step = 0; step < 6; step += 1) pressKey(remoteKeys.down);
    expect(document.activeElement).toBe(interval());
    expect(list()).toBeNull();

    // OK opens the list on the current value.
    pressKey(remoteKeys.enter);
    expect(interval().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.textContent).toBe("✓8 seconds");

    // Back closes the list unchanged and stays in Settings.
    pressKey(remoteKeys.back);
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(interval());
    expect(interval().getAttribute("aria-expanded")).toBe("false");
    expect(byId("settings-panel-display").hidden).toBe(false);

    // Left closes it unchanged.
    pressKey(remoteKeys.enter);
    expect(list()).not.toBeNull();
    pressKey(remoteKeys.left);
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(interval());

    // Up past the top closes it, and a further Up moves on.
    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.up);
    pressKey(remoteKeys.up);
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(interval());
    pressKey(remoteKeys.up);
    expect(document.activeElement).toBe(byId("show-viewer-exif"));

    // Coming back does not open it; choose 20 seconds and save.
    pressKey(remoteKeys.down);
    expect(list()).toBeNull();
    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.enter);
    expect(interval().textContent).toContain("20 seconds");
    byId("settings-save").focus();
    pressKey(remoteKeys.enter);
    expect(settingsStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ slideshowIntervalSeconds: 20 })
    );
  });

  it("offers Settings → Ambient, showing the album and order fields only where they apply", () => {
    const f = mount();
    controller!.show({ allowBack: true });
    byId("settings-section-ambient").focus();
    pressKey(remoteKeys.right);

    expect(document.activeElement).toBe(byId("ambient-source"));
    expect(byId("ambient-source").textContent).toContain("All photos");
    expect(byId("ambient-album-field").hidden).toBe(true);
    expect(byId("ambient-order-field").hidden).toBe(true);

    // Every control is reachable with Down, in order.
    const reached: string[] = [];
    for (let step = 0; step < 8; step += 1) {
      pressKey(remoteKeys.down);
      reached.push(document.activeElement?.id || "");
    }
    expect(reached).toEqual([
      "ambient-interval",
      "ambient-idle",
      "ambient-stop",
      "ambient-include-videos",
      "ambient-video-sound",
      "ambient-show-clock",
      "ambient-show-details",
      "ambient-start"
    ]);

    // Memories offers In order; an album also asks for the album.
    byId("ambient-source").focus();
    pressKey(remoteKeys.enter);
    for (let step = 0; step < 4; step += 1) pressKey(remoteKeys.down);
    pressKey(remoteKeys.enter);
    expect(byId("ambient-order-field").hidden).toBe(false);
    expect(byId("ambient-album-field").hidden).toBe(true);
    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.up);
    pressKey(remoteKeys.enter);
    expect(byId("ambient-album-field").hidden).toBe(false);

    byId("ambient-album").focus();
    pressKey(remoteKeys.enter);
    expect(f.onChooseAmbientAlbum).toHaveBeenCalledWith(null);
  });

  it("saves ambient choices, and Start now uses them unsaved", () => {
    const f = mount();
    controller!.show({ allowBack: true });
    byId("settings-section-ambient").focus();
    pressKey(remoteKeys.right);
    // Interval: 1 min.
    byId("ambient-interval").focus();
    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.enter);
    byId<HTMLInputElement>("ambient-show-details").click();

    byId("ambient-start").focus();
    pressKey(remoteKeys.enter);
    expect(f.onStartAmbient).toHaveBeenCalledWith(
      expect.objectContaining({ intervalSeconds: 60, showDetails: true })
    );
    expect(f.settingsStore.save).not.toHaveBeenCalled();

    byId("settings-save").focus();
    pressKey(remoteKeys.enter);
    expect(f.settingsStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        ambient: expect.objectContaining({ intervalSeconds: 60, showDetails: true })
      })
    );
    expect(f.onAppSettingsSaved).toHaveBeenCalledTimes(1);
  });

  it("leaves videos out of Start now while the OLED keep-awake is ticked, saved or not", () => {
    const f = mount();
    controller!.show({ allowBack: true });
    const includeVideos = byId<HTMLInputElement>("ambient-include-videos");
    if (!includeVideos.checked) includeVideos.click();

    byId("ambient-start").focus();
    pressKey(remoteKeys.enter);
    expect(f.onStartAmbient).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeVideos: true })
    );

    byId<HTMLInputElement>("oled-keep-awake").click();
    byId("ambient-start").focus();
    pressKey(remoteKeys.enter);
    expect(f.onStartAmbient).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeVideos: false })
    );
    expect(f.settingsStore.save).not.toHaveBeenCalled();
  });

  it("comes back from the album picker with the album and unsaved choices kept", () => {
    mount();
    controller!.show({ allowBack: true });
    byId<HTMLInputElement>("ambient-show-details").click();
    controller!.hide();

    controller!.resumeAfterAlbumPicker({ id: "album-1", name: "Summer Example" });
    controller!.focusAmbientAlbum();

    expect(document.activeElement).toBe(byId("ambient-album"));
    expect(byId("ambient-album").textContent).toBe("Summer Example");
    expect(byId<HTMLInputElement>("ambient-show-details").checked).toBe(true);
    expect(byId("settings-panel-ambient").hidden).toBe(false);
  });

  it("turns Home rails on and off in Home order, keeping settings saved elsewhere", () => {
    const { settingsStore } = mount({
      appSettings: {
        ...defaultAppSettings,
        homeRails: { ...defaultAppSettings.homeRails, albums: false }
      }
    });
    controller!.show({ allowBack: true });
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.down);
    expect(document.activeElement).toBe(byId("settings-section-home"));
    pressKey(remoteKeys.right);
    expect(byId("settings-panel-home").hidden).toBe(false);
    expect(document.activeElement).toBe(byId("home-rail-recently-added"));

    const labels = Array.prototype.map.call(
      byId("settings-panel-home").querySelectorAll(".field-label"),
      (label: Element) => label.textContent
    );
    expect(labels).toEqual([
      "Show Recently Added",
      "Show Favourites",
      "Show Videos",
      "Show People",
      "Show Recently Viewed",
      "Show Albums",
      "Show Memories"
    ]);
    expect(byId<HTMLInputElement>("home-rail-albums").checked).toBe(false);

    pressKey(remoteKeys.down);
    expect(document.activeElement).toBe(byId("home-rail-favorites"));
    pressKey(remoteKeys.enter);
    expect(byId("settings-save-label").textContent).toBe("Save *");

    byId("settings-save").focus();
    pressKey(remoteKeys.enter);
    expect(settingsStore.save).toHaveBeenCalledWith({
      ...defaultAppSettings,
      homeRails: { ...defaultAppSettings.homeRails, albums: false, favorites: false }
    });
  });

  it("focuses a requested section's button", () => {
    mount();
    controller!.show({ allowBack: true });
    controller!.focusSection("home");
    expect(document.activeElement).toBe(byId("settings-section-home"));
    pressKey(remoteKeys.enter);
    expect(byId("settings-panel-home").hidden).toBe(false);
  });

  it("guards an unsaved exit with Save and exit, Discard and Cancel", () => {
    const { onBack, onSaved } = mount();
    controller!.show({ allowBack: true });
    changeAutoplay();

    expect(controller!.requestExit()).toBe(false);
    expect(byId("settings-panel-unsaved").hidden).toBe(false);
    expect(document.activeElement?.getAttribute("data-action")).toBe("save-and-exit");

    pressKey(remoteKeys.down);
    pressKey(remoteKeys.down);
    expect(document.activeElement?.getAttribute("data-action")).toBe("cancel-exit");
    pressKey(remoteKeys.enter);
    expect(byId("settings-panel-unsaved").hidden).toBe(true);
    expect(byId("settings-summary").textContent).toBe("Exit cancelled.");

    pressKey(remoteKeys.back);
    pressKey(remoteKeys.down);
    expect(document.activeElement?.getAttribute("data-action")).toBe("discard-and-exit");
    pressKey(remoteKeys.enter);
    expect(onBack).toHaveBeenCalledWith({ bypassGuard: true });

    controller!.show({ allowBack: true });
    changeAutoplay();
    pressKey(remoteKeys.back);
    pressKey(remoteKeys.enter);
    expect(onSaved).toHaveBeenCalledWith(savedSettings);
  });

  it("exits immediately when nothing changed", () => {
    const { onBack } = mount();
    controller!.show({ allowBack: true });

    expect(controller!.requestExit()).toBe(true);
    pressKey(remoteKeys.back);
    expect(onBack).toHaveBeenCalledWith();
  });

  it("stays on first-run setup, then saving opens the app", () => {
    const { onBack, onReturnToShell, onSaved } = mount({ settings: null });
    controller!.show({ allowBack: false });

    expect(byId("connection-back").hidden).toBe(true);
    expect(byId<HTMLInputElement>("server-url").value).toBe("");
    pressKey(remoteKeys.back);
    expect(byId("settings-summary").textContent).toBe("Connection setup is the first screen.");
    expect(onBack).not.toHaveBeenCalled();

    pressKey(remoteKeys.left);
    expect(onReturnToShell).toHaveBeenCalledTimes(1);

    byId<HTMLInputElement>("server-url").value = "https://immich.example";
    byId<HTMLInputElement>("api-key").value = "test-key";
    byId("settings-save").focus();
    pressKey(remoteKeys.enter);
    expect(onSaved).toHaveBeenCalledWith(savedSettings);
  });

  it("stops the dirty-state timer when hidden", () => {
    vi.useFakeTimers();
    try {
      mount();
      controller!.show({ allowBack: true });
      expect(vi.getTimerCount()).toBe(1);
      controller!.hide();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
