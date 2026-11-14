import type { AlbumService } from "../../app/album-service";
import type { AmbientAssetSource } from "../../app/ambient-sources";
import type { AlbumAsset } from "../../domain/album";
import type { AmbientSettings } from "../../domain/ambient";
import { noPassiveViewing, type PassiveViewing } from "../../platform/tizen/screensaver";
import { formatAmbientClock, formatAmbientSourceName } from "../../presentation/ambient-labels";
import { formatViewerMetadata } from "../asset-viewer-window";
import { createAmbientPlayer, type AmbientPlayer, type AmbientPlayerState } from "./ambient-player";
import { createAmbientTimers } from "./ambient-timers";

// Ambient mode's full-screen surface (ADR 0019), above everything else:
// the crossfading pictures (ambient-player.ts), a quiet clock and photo
// details that move around the safe area against burn-in, and a calm
// message when there is nothing to show or the server can't be reached.
// Any key exits, and that press does nothing else: a screensaver must never
// act on the first key press. While shown it holds the TV's own
// screensaver off.

// The overlays move to a new place this often.
export const ambientOverlayMoveMs = 3 * 60 * 1000;
export const ambientOverlayPositions = 4;
const clockTickMs = 10000;

type AmbientScreenOptions = {
  documentRef?: Document;
  now?(): Date;
  // Any key, or a click: ambient mode should end.
  onExit(): void;
  passiveViewing?: PassiveViewing;
  service: Pick<
    AlbumService,
    "loadAssetPlaybackUrl" | "loadAssetViewerStillUrl" | "revokeImageUrl"
  >;
};

export type AmbientStartOptions = {
  // Started by the idle timer: show nothing unless there is a picture.
  quiet: boolean;
  settings: AmbientSettings;
  source: AmbientAssetSource;
};

export type AmbientScreenController = {
  destroy(): void;
  // Preview URLs held, for long-run checks.
  heldUrlCount(): number;
  isActive(): boolean;
  // "started" once ambient mode shows; "unavailable" when a quiet start
  // found nothing to show, or no server, and so never showed.
  start(options: AmbientStartOptions): Promise<"started" | "unavailable">;
  stop(): void;
  // Timers running, for long-run checks.
  timerCount(): number;
};

export function mountAmbientScreen(options: AmbientScreenOptions): AmbientScreenController {
  const documentRef = options.documentRef || document;
  const root = requireElement(documentRef, "ambient-screen");
  const overlay = requireElement(documentRef, "ambient-overlay");
  const clock = requireElement(documentRef, "ambient-clock");
  const details = requireElement(documentRef, "ambient-details");
  const message = requireElement(documentRef, "ambient-message");
  const layers: [HTMLImageElement, HTMLImageElement] = [
    requireElement<HTMLImageElement>(documentRef, "ambient-layer-a"),
    requireElement<HTMLImageElement>(documentRef, "ambient-layer-b")
  ];
  const video = requireElement<HTMLVideoElement>(documentRef, "ambient-video");
  const timers = createAmbientTimers();
  const playerTimers = createAmbientTimers();
  // Ambient mode shows photos, and videos only with the OLED keep-awake off
  // (ADR 0023).
  const hold = (options.passiveViewing || noPassiveViewing).createHold("photos");
  const now = options.now || (() => new Date());
  let player: AmbientPlayer | null = null;
  let active = false;
  let settings: AmbientSettings | null = null;
  let swallowKeyup = false;
  let position = 0;
  let startId = 0;

  function setMessage(text: string): void {
    message.textContent = text;
    message.hidden = !text;
  }

  function tickClock(): void {
    clock.textContent = formatAmbientClock(now());
    timers.set(tickClock, clockTickMs);
  }

  function moveOverlay(): void {
    position = (position + 1) % ambientOverlayPositions;
    overlay.setAttribute("data-position", String(position));
    timers.set(moveOverlay, ambientOverlayMoveMs);
  }

  function showDetails(asset: AlbumAsset): void {
    const metadata = formatViewerMetadata(asset);

    details.textContent = [metadata.date, metadata.location].filter((part) => part).join(" · ");
  }

  function show(): void {
    active = true;
    root.hidden = false;
    root.focus();
    hold.set(true);
    position = 0;
    overlay.setAttribute("data-position", "0");
    clock.hidden = !settings!.showClock;
    details.hidden = !settings!.showDetails;
    details.textContent = "";

    if (settings!.showClock) {
      tickClock();
    }

    timers.set(moveOverlay, ambientOverlayMoveMs);
  }

  function showState(state: AmbientPlayerState): void {
    if (state.kind === "playing") {
      setMessage("");
    } else if (state.kind === "empty") {
      setMessage(
        `Nothing to show from ${formatAmbientSourceName(settings!)}. You can change it in Settings → Ambient.`
      );
    } else {
      details.textContent = "";
      setMessage("Can't reach your Immich server. Trying again…");
    }
  }

  function stop(): void {
    startId += 1;
    active = false;
    player?.stop();
    player = null;
    timers.clearAll();
    root.hidden = true;
    setMessage("");
    details.textContent = "";
    hold.set(false);
  }

  const handleKeydown = (event: KeyboardEvent) => {
    if (!active) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    swallowKeyup = true;
    options.onExit();
  };
  const handleKeyup = (event: KeyboardEvent) => {
    // The press that ended ambient mode must not reach the screen beneath.
    if (swallowKeyup) {
      swallowKeyup = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const handleClick = (event: MouseEvent) => {
    if (active) {
      event.preventDefault();
      options.onExit();
    }
  };

  // The window's capture phase comes before every document listener, the
  // shell's root Back (which would ask to exit the app) included.
  const keyTarget: EventTarget = documentRef.defaultView || documentRef;

  keyTarget.addEventListener("keydown", handleKeydown as EventListener, true);
  keyTarget.addEventListener("keyup", handleKeyup as EventListener, true);
  root.addEventListener("click", handleClick);

  return {
    destroy() {
      stop();
      keyTarget.removeEventListener("keydown", handleKeydown as EventListener, true);
      keyTarget.removeEventListener("keyup", handleKeyup as EventListener, true);
      root.removeEventListener("click", handleClick);
    },
    heldUrlCount: () => player?.heldUrlCount() ?? 0,
    isActive: () => active,
    start(start) {
      stop();
      settings = start.settings;
      const id = startId;

      if (!start.quiet) {
        show();
      }

      return new Promise((resolve) => {
        let settled = false;
        const settle = (outcome: "started" | "unavailable") => {
          if (!settled) {
            settled = true;
            resolve(outcome);
          }
        };

        player = createAmbientPlayer({
          elements: { layers, video },
          intervalMs: start.settings.intervalSeconds * 1000,
          videoSound: start.settings.videoSound,
          onShow(asset) {
            showDetails(asset);
          },
          onState(state) {
            if (id !== startId) {
              return;
            }

            if (start.quiet && !active) {
              if (state.kind !== "playing") {
                stop();
                settle("unavailable");
                return;
              }

              show();
            }

            showState(state);
            settle("started");
          },
          service: options.service,
          source: start.source,
          timers: playerTimers
        });
        player.start();

        if (!start.quiet) {
          settle("started");
        }
      });
    },
    stop,
    timerCount: () => timers.count() + playerTimers.count()
  };
}

function requireElement<T extends HTMLElement = HTMLElement>(documentRef: Document, id: string): T {
  const element = documentRef.getElementById(id);

  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }

  return element as T;
}
