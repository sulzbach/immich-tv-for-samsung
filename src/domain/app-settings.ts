import type { SortOrder } from "./album";
import { defaultAmbientSettings, normalizeAmbientSettings, type AmbientSettings } from "./ambient";
import { homeRailOrder, type HomeRailVisibility } from "./home";

// Collections whose sort order is remembered between visits. An album's
// order comes from Immich instead, and reversing it lasts the session.
export type SavedSortOrderKind = "favorites" | "people" | "photos" | "search" | "videos";

export type SavedSortOrders = Record<SavedSortOrderKind, SortOrder>;

const savedSortOrderKinds: SavedSortOrderKind[] = [
  "favorites",
  "people",
  "photos",
  "search",
  "videos"
];

// How long the viewer's buttons stay during a slideshow or video before they
// fade, in seconds, or never (ADR 0006, ADR 0020).
export type PlaybackButtonsHide = 3 | 5 | 10 | 15 | "never";

export const playbackButtonsHideOptions: PlaybackButtonsHide[] = [3, 5, 10, 15, "never"];

export const defaultPlaybackButtonsHide: PlaybackButtonsHide = 5;

export type AppSettings = {
  ambient: AmbientSettings;
  autoplayVideos: boolean;
  // White text on solid dark, with stronger edges and focus (ADR 0020).
  highContrast: boolean;
  homeRails: HomeRailVisibility;
  // Plays a hidden black video during slideshows and ambient mode, which
  // keeps Samsung's OLED screensaver away, and shows videos there as stills
  // (ADR 0023). Off unless the user turns it on.
  oledKeepAwake: boolean;
  playbackButtonsHide: PlaybackButtonsHide;
  // Face tags over photos in the viewer (the viewer's Faces button).
  showFaceTags: boolean;
  showViewerDate: boolean;
  showViewerExif: boolean;
  showViewerTime: boolean;
  slideshowIntervalSeconds: number;
  sortOrders: SavedSortOrders;
  // The user says they have tipped (Settings › Support Us, ADR 0021). It is
  // taken on trust, changes only the splash's line and unlocks nothing.
  supporter: boolean;
};

export const defaultSlideshowIntervalSeconds = 8;

export const defaultAppSettings: AppSettings = {
  ambient: defaultAmbientSettings,
  autoplayVideos: false,
  highContrast: false,
  homeRails: normalizeHomeRailVisibility(null),
  oledKeepAwake: false,
  playbackButtonsHide: defaultPlaybackButtonsHide,
  showFaceTags: false,
  showViewerDate: true,
  showViewerExif: true,
  showViewerTime: true,
  slideshowIntervalSeconds: defaultSlideshowIntervalSeconds,
  sortOrders: normalizeSavedSortOrders(null),
  supporter: false
};

export function normalizeAppSettings(settings: Partial<AppSettings> | null): AppSettings {
  return {
    ambient: normalizeAmbientSettings(settings?.ambient),
    autoplayVideos: settings?.autoplayVideos === true,
    highContrast: settings?.highContrast === true,
    homeRails: normalizeHomeRailVisibility(settings?.homeRails),
    oledKeepAwake: settings?.oledKeepAwake === true,
    playbackButtonsHide: normalizePlaybackButtonsHide(settings?.playbackButtonsHide),
    showFaceTags: settings?.showFaceTags === true,
    showViewerDate: settings?.showViewerDate !== false,
    showViewerExif: settings?.showViewerExif !== false,
    showViewerTime: settings?.showViewerTime !== false,
    slideshowIntervalSeconds: normalizeSlideshowIntervalSeconds(settings?.slideshowIntervalSeconds),
    sortOrders: normalizeSavedSortOrders(settings?.sortOrders),
    supporter: settings?.supporter === true
  };
}

export function normalizeSlideshowIntervalSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultSlideshowIntervalSeconds;
  }

  const roundedValue = Math.round(value);

  if (roundedValue < 3 || roundedValue > 60) {
    return defaultSlideshowIntervalSeconds;
  }

  return roundedValue;
}

export function normalizePlaybackButtonsHide(value: unknown): PlaybackButtonsHide {
  return (
    playbackButtonsHideOptions.find((option) => option === value) ?? defaultPlaybackButtonsHide
  );
}

// Milliseconds before the buttons fade, or null to keep them.
export function readPlaybackButtonsHideMs(settings: AppSettings): number | null {
  const hide = settings.playbackButtonsHide;

  return hide === "never" ? null : hide * 1000;
}

// Whether a slideshow plays its videos in full. With the OLED keep-awake on,
// it shows them as stills, so the hidden video never plays beside a real one
// (ADR 0023).
export function slideshowPlaysVideos(settings: AppSettings): boolean {
  return settings.autoplayVideos && !settings.oledKeepAwake;
}

// Ambient mode's settings as they apply: with the OLED keep-awake on, it
// shows photos only, and Live Photos as stills (ADR 0023).
export function readEffectiveAmbientSettings(settings: AppSettings): AmbientSettings {
  return settings.oledKeepAwake
    ? { ...settings.ambient, includeVideos: false, livePhotoMotion: false }
    : settings.ambient;
}

// Keeps only known rails; a rail missing from stored settings, for example
// one added in a later release, is on.
export function normalizeHomeRailVisibility(value: unknown): HomeRailVisibility {
  const stored = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const visibility = {} as HomeRailVisibility;

  homeRailOrder.forEach((railId) => {
    visibility[railId] = stored[railId] !== false;
  });

  return visibility;
}

export function readEnabledHomeRails(settings: AppSettings): typeof homeRailOrder {
  return homeRailOrder.filter((railId) => settings.homeRails[railId]);
}

// Newest first unless oldest first was chosen.
export function normalizeSavedSortOrders(value: unknown): SavedSortOrders {
  const stored = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const orders = {} as SavedSortOrders;

  savedSortOrderKinds.forEach((kind) => {
    orders[kind] = stored[kind] === "oldest-first" ? "oldest-first" : "newest-first";
  });

  return orders;
}
