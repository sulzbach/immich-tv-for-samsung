// Ambient mode's settings (ADR 0019): what plays, how, and when it starts and
// stops. Every value is normalised, so an unknown stored value falls back to
// its default.

export type AmbientSource = "album" | "all" | "favorites" | "memories" | "recent";

export type AmbientOrder = "in-order" | "shuffle";

export type AmbientSettings = {
  // The album played when the source is "album", and its name for display.
  album: { id: string; name: string } | null;
  includeVideos: boolean;
  intervalSeconds: number;
  // Used only where it applies (ambientOrderApplies); shuffle otherwise.
  order: AmbientOrder;
  showClock: boolean;
  showDetails: boolean;
  source: AmbientSource;
  // 0 is Off.
  startAfterIdleMinutes: number;
  // 0 is Never.
  stopAfterHours: number;
  // Videos play with their sound; off (muted) by default.
  videoSound: boolean;
};

export const ambientSources: AmbientSource[] = ["all", "favorites", "recent", "album", "memories"];
export const ambientIntervalOptions = [10, 20, 30, 60, 120, 300];
export const ambientIdleOptions = [0, 5, 10, 15, 30];
export const ambientStopOptions = [0, 1, 2, 4];

// Recent means taken in the last this many days.
export const ambientRecentDays = 90;

// One draw of random assets: within an album or not, photos alone or with
// videos, and taken on or after a moment.
export type AmbientRandomQuery = {
  albumId: string | null;
  includeVideos: boolean;
  takenFrom: Date | null;
};

export const defaultAmbientSettings: AmbientSettings = {
  album: null,
  includeVideos: false,
  intervalSeconds: 30,
  order: "shuffle",
  showClock: true,
  showDetails: false,
  source: "all",
  startAfterIdleMinutes: 0,
  stopAfterHours: 0,
  videoSound: false
};

// In order is offered for an album and for Memories only.
export function ambientOrderApplies(source: AmbientSource): boolean {
  return source === "album" || source === "memories";
}

// The order a source plays in.
export function readAmbientOrder(settings: AmbientSettings): AmbientOrder {
  return ambientOrderApplies(settings.source) ? settings.order : "shuffle";
}

// An album source needs an album; without one, ambient mode has nothing to
// play and says so.
export function normalizeAmbientSettings(value: unknown): AmbientSettings {
  const stored = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const album = stored.album as Record<string, unknown> | null | undefined;

  return {
    album:
      album && typeof album.id === "string" && album.id && typeof album.name === "string"
        ? { id: album.id, name: album.name }
        : null,
    includeVideos: stored.includeVideos === true,
    intervalSeconds: oneOf(
      stored.intervalSeconds,
      ambientIntervalOptions,
      defaultAmbientSettings.intervalSeconds
    ),
    order: stored.order === "in-order" ? "in-order" : "shuffle",
    showClock: stored.showClock !== false,
    showDetails: stored.showDetails === true,
    source: oneOf(stored.source, ambientSources, defaultAmbientSettings.source),
    startAfterIdleMinutes: oneOf(stored.startAfterIdleMinutes, ambientIdleOptions, 0),
    stopAfterHours: oneOf(stored.stopAfterHours, ambientStopOptions, 0),
    videoSound: stored.videoSound === true
  };
}

function oneOf<T>(value: unknown, options: T[], fallback: T): T {
  return options.indexOf(value as T) >= 0 ? (value as T) : fallback;
}
