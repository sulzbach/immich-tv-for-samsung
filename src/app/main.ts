import { consoleLogger } from "../logging/logger";
import { createKeepAwake } from "../platform/tizen/keep-awake";
import { registerOptionalRemoteKeys } from "../platform/tizen/keys";
import { createAmbientOnPowerOn } from "../platform/tizen/ambient-on-power-on";
import { createAppLifecycle } from "../platform/tizen/lifecycle";
import { createPassiveViewing } from "../platform/tizen/screensaver";
import { createLocalAppSettingsStore } from "../storage/app-settings-store";
import { createLocalConnectionSettingsStore } from "../storage/connection-settings-store";
import { createLocalViewingHistoryStore } from "../storage/viewing-history-store";
import { showSplashSupport } from "../screens/splash-support";
import { applyContrastTheme } from "../screens/theme";
import { createAlbumService } from "./album-service";
import { composeApplication } from "./application";
import { createConnectionService } from "./connection-service";
import { supportLinksEnabled, supportPage } from "./distribution";
import { applyInstallPreset } from "./install-preset";
import { createViewingHistoryService } from "./viewing-history-service";

// Entry point: creates the real services and platform adapters for the TV
// runtime, then composes and starts the application.

const settingsStore = createLocalAppSettingsStore(window.localStorage);
const startupSettings = settingsStore.load();

// The theme first, before the splash is next drawn, so high contrast never
// flashes the normal colours (ADR 0020), and the splash's support line with
// it (ADR 0021).
applyContrastTheme(document, startupSettings.highContrast);
showSplashSupport(document, supportLinksEnabled, startupSettings.supporter);

// Let the TV draw the splash before the app is assembled behind it: building
// every screen and starting Home takes a noticeable moment on the TV, and
// until this script yields nothing on the page can be drawn.
afterNextPaint(() => {
  const store = createLocalConnectionSettingsStore(window.localStorage);
  const fetchImpl = window.fetch.bind(window);
  const lifecycle = createAppLifecycle({ logger: consoleLogger });

  registerOptionalRemoteKeys(window, consoleLogger);
  // Before the app starts, so it opens connected when an installer provided
  // the details (ADR 0022).
  applyInstallPreset({
    connections: store,
    logger: consoleLogger,
    preset: (window as InstallPresetWindow).IMMICH_TV_INSTALL_PRESET,
    storage: window.localStorage
  });

  const application = composeApplication({
    ambientOnPowerOn: createAmbientOnPowerOn(window, consoleLogger),
    albumService: createAlbumService({ fetchImpl, logger: consoleLogger, store }),
    connectionService: createConnectionService({ fetchImpl, logger: consoleLogger, store }),
    lifecycle,
    logger: consoleLogger,
    passiveViewing: createPassiveViewing({
      keepAwake: createKeepAwake({
        documentRef: document,
        enabled: () => settingsStore.load().oledKeepAwake,
        logger: consoleLogger
      }),
      logger: consoleLogger
    }),
    settingsStore,
    supportPage,
    viewingHistory: createViewingHistoryService({
      connections: store,
      fetchImpl,
      history: createLocalViewingHistoryStore(window.localStorage),
      logger: consoleLogger
    })
  });

  application.start();

  window.addEventListener("pagehide", () => {
    lifecycle.destroy();
    application.destroy();
  });
});

// Set by scripts/install-preset.js, which loads before this bundle.
type InstallPresetWindow = Window & { IMMICH_TV_INSTALL_PRESET?: unknown };

// A requestAnimationFrame callback runs just before a frame is drawn; the
// timeout then runs after that frame, once the splash is on screen.
function afterNextPaint(callback: () => void): void {
  window.requestAnimationFrame(() => {
    window.setTimeout(callback, 0);
  });
}
