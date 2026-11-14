import {
  ambientIdleOptions,
  ambientIntervalOptions,
  ambientPanSpeedOptions,
  ambientOrderApplies,
  ambientSources,
  ambientStopOptions,
  normalizeAmbientSettings,
  type AmbientSettings,
  type AmbientSource
} from "../../domain/ambient";
import {
  ambientSourceLabels,
  formatAmbientIdle,
  formatAmbientPanSpeed,
  formatAmbientSeconds,
  formatAmbientStop
} from "../../presentation/ambient-labels";
import { mountSettingsDropdown } from "./settings-dropdown";
import { requireElement, type SettingsSection } from "./settings-section";

// Settings > Ambient (ADR 0019): what ambient mode plays and when it starts
// and stops, using the app's drop-downs and the On/Off pattern. The album
// field shows only for the album source, and Order only where In order
// applies. Start now and Choose an album are actions the Settings screen
// routes (start-ambient, choose-ambient-album). Include videos and Play Live
// Photo motion are off and locked while the OLED keep-awake is on (ADR 0023).

export type AmbientSection = SettingsSection & {
  // The section's current choices, saved or not.
  current(): AmbientSettings;
  // The album picked in the album picker.
  setAlbum(album: { id: string; name: string }): void;
  // Unlocks Include videos and Play Live Photo motion, or turns them off and
  // locks them.
  setVideosAllowed(allowed: boolean): void;
};

export function createAmbientSection(documentRef: Document): AmbientSection {
  const albumField = requireElement(documentRef, "ambient-album-field");
  const albumButton = requireElement<HTMLButtonElement>(documentRef, "ambient-album");
  const orderField = requireElement(documentRef, "ambient-order-field");
  const includeVideos = requireElement<HTMLInputElement>(documentRef, "ambient-include-videos");
  const livePhotoMotion = requireElement<HTMLInputElement>(
    documentRef,
    "ambient-live-photo-motion"
  );
  const livePhotoSound = requireElement<HTMLInputElement>(documentRef, "ambient-live-photo-sound");
  const panPortraits = requireElement<HTMLInputElement>(documentRef, "ambient-pan-portraits");
  const panHint = requireElement(documentRef, "ambient-pan-portraits-hint");
  const panHintText = panHint.textContent || "";
  const panSpeedField = requireElement(documentRef, "ambient-pan-speed-field");
  const videoChoices = [
    lockableChoice(includeVideos, requireElement(documentRef, "ambient-include-videos-hint")),
    lockableChoice(livePhotoMotion, requireElement(documentRef, "ambient-live-photo-motion-hint"))
  ];
  const videoSound = requireElement<HTMLInputElement>(documentRef, "ambient-video-sound");
  const showClock = requireElement<HTMLInputElement>(documentRef, "ambient-show-clock");
  const showDetails = requireElement<HTMLInputElement>(documentRef, "ambient-show-details");
  let album: AmbientSettings["album"] = null;

  const source = mountSettingsDropdown({
    control: requireElement<HTMLButtonElement>(documentRef, "ambient-source"),
    name: "Source",
    onChange: updateFields,
    options: ambientSources.map((value) => ({ label: ambientSourceLabels[value], value }))
  });
  const order = mountSettingsDropdown({
    control: requireElement<HTMLButtonElement>(documentRef, "ambient-order"),
    name: "Order",
    options: [
      { label: "Shuffle", value: "shuffle" },
      { label: "In order", value: "in-order" }
    ]
  });
  const interval = mountSettingsDropdown({
    control: requireElement<HTMLButtonElement>(documentRef, "ambient-interval"),
    name: "Interval",
    options: ambientIntervalOptions.map((seconds) => ({
      label: formatAmbientSeconds(seconds),
      value: String(seconds)
    }))
  });
  const idle = mountSettingsDropdown({
    control: requireElement<HTMLButtonElement>(documentRef, "ambient-idle"),
    name: "Start after idle",
    options: ambientIdleOptions.map((minutes) => ({
      label: formatAmbientIdle(minutes),
      value: String(minutes)
    }))
  });
  const panSpeed = mountSettingsDropdown({
    control: requireElement<HTMLButtonElement>(documentRef, "ambient-pan-speed"),
    name: "Pan speed",
    options: ambientPanSpeedOptions.map((pixels) => ({
      label: formatAmbientPanSpeed(pixels),
      value: String(pixels)
    }))
  });
  const stop = mountSettingsDropdown({
    control: requireElement<HTMLButtonElement>(documentRef, "ambient-stop"),
    name: "Stop after",
    options: ambientStopOptions.map((hours) => ({
      label: formatAmbientStop(hours),
      value: String(hours)
    }))
  });

  function updateFields(): void {
    const chosen = source.value() as AmbientSource;

    albumField.hidden = chosen !== "album";
    orderField.hidden = !ambientOrderApplies(chosen);
    albumButton.textContent = album ? album.name : "Choose an album";
    albumButton.setAttribute("aria-label", album ? `Album: ${album.name}` : "Choose an album");
  }

  // Pan portrait photos and Play Live Photo motion don't go together (a
  // panning photo with motion playing over it): turning the motion on turns
  // the pan off and locks it; turning the motion off unlocks the pan and,
  // when the change is the viewer's, turns it on. Pan speed shows only while
  // the pan can play.
  function updatePan(motionChangedByViewer: boolean): void {
    if (livePhotoMotion.checked) {
      panPortraits.checked = false;
      panPortraits.setAttribute("aria-disabled", "true");
      panHint.textContent = "Off while Play Live Photo motion is on.";
    } else {
      if (panPortraits.getAttribute("aria-disabled") === "true" && motionChangedByViewer) {
        panPortraits.checked = true;
      }

      panPortraits.removeAttribute("aria-disabled");
      panHint.textContent = panHintText;
    }

    panSpeedField.hidden = !panPortraits.checked;
  }

  livePhotoMotion.addEventListener("change", () => updatePan(true));
  panPortraits.addEventListener("change", () => updatePan(false));
  // A pointer click can't tick it while it is locked.
  panPortraits.addEventListener("click", (event) => {
    if (panPortraits.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
    }
  });

  function setVideosAllowed(allowed: boolean): void {
    videoChoices.forEach((choice) => choice.setAllowed(allowed));
    updatePan(false);
  }

  function current(): AmbientSettings {
    return normalizeAmbientSettings({
      album,
      includeVideos: includeVideos.checked,
      intervalSeconds: Number(interval.value()),
      livePhotoMotion: livePhotoMotion.checked,
      livePhotoSound: livePhotoSound.checked,
      panPortraits: panPortraits.checked,
      panSpeed: Number(panSpeed.value()),
      order: order.value(),
      showClock: showClock.checked,
      showDetails: showDetails.checked,
      source: source.value(),
      startAfterIdleMinutes: Number(idle.value()),
      stopAfterHours: Number(stop.value()),
      videoSound: videoSound.checked
    });
  }

  return {
    button: requireElement<HTMLButtonElement>(documentRef, "settings-section-ambient"),
    current,
    dropdowns: [source, order, interval, idle, stop, panSpeed],
    firstControl: () => source.control,
    id: "ambient",
    panel: requireElement(documentRef, "settings-panel-ambient"),
    readAppSettings: () => ({ ambient: current() }),
    setAlbum(chosen) {
      album = { id: chosen.id, name: chosen.name };
      updateFields();
    },
    setVideosAllowed,
    showAppSettings(settings) {
      const ambient = settings.ambient;

      setVideosAllowed(true);
      album = ambient.album;
      source.setValue(ambient.source);
      order.setValue(ambient.order);
      interval.setValue(String(ambient.intervalSeconds));
      idle.setValue(String(ambient.startAfterIdleMinutes));
      stop.setValue(String(ambient.stopAfterHours));
      includeVideos.checked = ambient.includeVideos;
      videoSound.checked = ambient.videoSound;
      livePhotoMotion.checked = ambient.livePhotoMotion;
      livePhotoSound.checked = ambient.livePhotoSound;
      panPortraits.checked = ambient.panPortraits;
      panSpeed.setValue(String(ambient.panSpeed));
      showClock.checked = ambient.showClock;
      showDetails.checked = ambient.showDetails;
      setVideosAllowed(!settings.oledKeepAwake);
      updateFields();
      updatePan(false);
    },
    snapshot: current
  };
}

// An On/Off choice that the OLED keep-awake turns off and locks, keeping the
// choice to bring back when it is unlocked. A pointer click can't tick it
// while it is locked; the Settings screen ignores Enter on it.
function lockableChoice(input: HTMLInputElement, hint: HTMLElement) {
  const hintText = hint.textContent || "";
  let lockedChoice: boolean | null = null;

  input.addEventListener("click", (event) => {
    if (lockedChoice !== null) {
      event.preventDefault();
    }
  });

  return {
    setAllowed(allowed: boolean): void {
      if (allowed === (lockedChoice === null)) {
        return;
      }

      if (allowed) {
        input.checked = lockedChoice === true;
        lockedChoice = null;
        input.removeAttribute("aria-disabled");
        hint.textContent = hintText;
      } else {
        lockedChoice = input.checked;
        input.checked = false;
        input.setAttribute("aria-disabled", "true");
        hint.textContent = "Off while Keep OLED screensaver away is on, in Display.";
      }
    }
  };
}
