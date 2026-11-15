import type { AmbientSettings } from "../domain/ambient";
import type { Logger } from "../logging/logger";
import type { AppLifecycle } from "../platform/tizen/lifecycle";
import type { AmbientScreenController } from "../screens/ambient/ambient-screen";
import type { AmbientAssetSource } from "./ambient-sources";

// When ambient mode starts and stops (ADR 0019):
// - Start now, from Settings → Ambient.
// - Start after idle: counted from the last key, that starts ambient mode
//   only over a browsing screen (the app decides which). A quiet start shows
//   nothing unless there is a picture to show.
// Idle and Stop after are measured against the wall clock and checked at
// least every 30 seconds, never with one long timer: on the TV a single
// timer of 10 minutes or more was seen not to fire, and Samsung documents
// nothing about long timers on Tizen.
// - Any key, or Stop after, ends it and returns exactly where you were: the
//   same screen and the same focused control. Ending releases the TV's
//   screensaver, so its own power saving can take over overnight.
// - Hiding the app stops ambient mode and its media. Showing it again
//   resumes a manual start; an idle start returns to where you were.

export type AmbientOrigin = "idle" | "manual";

// The longest single timer the controller sets.
export const ambientCheckMs = 30000;

type AmbientControllerOptions = {
  // Whether ambient mode may start by itself over the screen now showing.
  canStartFromIdle(): boolean;
  createSource(settings: AmbientSettings): AmbientAssetSource;
  documentRef?: Document;
  lifecycle: Pick<AppLifecycle, "onVisibilityChange">;
  logger?: Pick<Logger, "info">;
  // After ambient mode ends; focus is already back where it was if that
  // control still exists, so this is the fallback.
  onEnded(focusRestored: boolean): void;
  onStarted(): void;
  screen: Pick<AmbientScreenController, "isActive" | "start" | "stop">;
  // The saved settings.
  settings(): AmbientSettings;
  windowRef?: Pick<Window, "clearTimeout" | "setTimeout">;
};

export type AmbientController = {
  destroy(): void;
  // Ends ambient mode and returns where you were (any key does this).
  exit(): void;
  isActive(): boolean;
  // Re-reads the saved settings, for example after Settings are saved.
  refresh(): void;
  // Starts now with these settings (the Settings form's current choices).
  startNow(settings: AmbientSettings): void;
  // Starts quietly with the saved settings, as an idle start does, when the
  // TV turns on (ADR 0024); not while already active. Resolves once ambient
  // mode shows, or has nothing to show, or was already active.
  startIdle(startOptions?: { overSplash?: boolean }): Promise<void>;
};

type Session = {
  deadline: number | null;
  origin: AmbientOrigin;
  returnFocus: Element | null;
  settings: AmbientSettings;
};

export function createAmbientController(options: AmbientControllerOptions): AmbientController {
  const documentRef = options.documentRef || document;
  const windowRef = options.windowRef || window;
  let session: Session | null = null;
  let hiddenSession: Session | null = null;
  let idleTimer: number | null = null;
  let stopTimer: number | null = null;
  // When the idle countdown started: the last key, or the last refused start.
  let lastActivity = Date.now();
  let visible = true;
  let startId = 0;

  function clearIdle(): void {
    if (idleTimer !== null) {
      windowRef.clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function clearStop(): void {
    if (stopTimer !== null) {
      windowRef.clearTimeout(stopTimer);
      stopTimer = null;
    }
  }

  // Restarts the idle countdown from now.
  function armIdle(): void {
    lastActivity = Date.now();
    checkIdle();
  }

  function checkIdle(): void {
    clearIdle();

    const minutes = options.settings().startAfterIdleMinutes;

    if (minutes === 0 || !visible || session) {
      return;
    }

    const remaining = lastActivity + minutes * 60 * 1000 - Date.now();

    if (remaining > 0) {
      idleTimer = windowRef.setTimeout(checkIdle, Math.min(remaining, ambientCheckMs));
      return;
    }

    if (options.canStartFromIdle()) {
      options.logger?.info("Ambient mode starting after idle.", { minutes });
      void start("idle", options.settings(), documentRef.activeElement, null);
    } else {
      options.logger?.info("Ambient mode idle start skipped: not a browsing screen.", {
        minutes
      });
      armIdle();
    }
  }

  function scheduleStop(current: Session): void {
    clearStop();

    if (current.deadline === null) {
      return;
    }

    const remaining = current.deadline - Date.now();

    if (remaining <= 0) {
      end();
      return;
    }

    stopTimer = windowRef.setTimeout(
      () => {
        stopTimer = null;
        scheduleStop(current);
      },
      Math.min(remaining, ambientCheckMs)
    );
  }

  function start(
    origin: AmbientOrigin,
    settings: AmbientSettings,
    returnFocus: Element | null,
    deadline: number | null,
    overSplash = false
  ): Promise<void> {
    if (session) {
      return Promise.resolve();
    }

    const id = (startId += 1);
    const current: Session = {
      deadline:
        deadline ??
        (settings.stopAfterHours > 0
          ? Date.now() + settings.stopAfterHours * 60 * 60 * 1000
          : null),
      origin,
      returnFocus,
      settings
    };

    clearIdle();
    session = current;
    options.onStarted();
    scheduleStop(current);
    return options.screen
      .start({
        quiet: origin === "idle",
        overSplash,
        settings,
        source: options.createSource(settings)
      })
      .then((outcome) => {
        // A quiet start with nothing to show never showed: carry on as before.
        if (outcome === "unavailable" && id === startId && session === current) {
          options.logger?.info("Ambient mode idle start found nothing to show.");
          finish(current);
        }
      });
  }

  function finish(ended: Session): void {
    startId += 1;
    session = null;
    clearStop();
    options.screen.stop();

    const target = ended.returnFocus as HTMLElement | null;
    const restorable =
      Boolean(target) &&
      documentRef.contains(target) &&
      target !== documentRef.body &&
      !target!.closest("[hidden]");

    if (restorable) {
      target!.focus();
    }

    options.onEnded(restorable);
    armIdle();
  }

  function end(): void {
    if (session) {
      finish(session);
    }
  }

  const handleKeydown = () => {
    // Any key while browsing restarts the idle countdown.
    if (!session) {
      armIdle();
    }
  };
  const stopListening = options.lifecycle.onVisibilityChange((visibility) => {
    visible = visibility === "visible";

    if (!visible) {
      clearIdle();

      if (session) {
        // Stop ambient mode and its media; remember how it started.
        hiddenSession = session;
        startId += 1;
        session = null;
        clearStop();
        options.screen.stop();
      }

      return;
    }

    const resumed = hiddenSession;

    hiddenSession = null;

    if (resumed?.origin === "manual") {
      if (resumed.deadline !== null && resumed.deadline <= Date.now()) {
        finish(resumed);
        return;
      }

      void start("manual", resumed.settings, resumed.returnFocus, resumed.deadline);
      return;
    }

    if (resumed) {
      finish(resumed);
      return;
    }

    armIdle();
  });

  documentRef.addEventListener("keydown", handleKeydown, true);
  armIdle();

  return {
    destroy() {
      clearIdle();
      clearStop();
      stopListening();
      documentRef.removeEventListener("keydown", handleKeydown, true);
      if (session) {
        session = null;
        options.screen.stop();
      }
    },
    exit: end,
    isActive: () => session !== null,
    refresh: armIdle,
    startNow(settings) {
      void start("manual", settings, documentRef.activeElement, null);
    },
    startIdle(startOptions = {}) {
      return start(
        "idle",
        options.settings(),
        documentRef.activeElement,
        null,
        startOptions.overSplash === true
      );
    }
  };
}
