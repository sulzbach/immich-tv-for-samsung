import type { AmbientSettings, AmbientSource } from "../domain/ambient";

// Household-facing words for ambient mode (ADR 0019).

export const ambientSourceLabels: Record<AmbientSource, string> = {
  album: "Album",
  all: "All photos",
  favorites: "Favourites",
  memories: "Memories",
  recent: "Recent"
};

// Pan portrait photos' scroll speeds, in pixels a second.
export function formatAmbientPanSpeed(pixelsPerSecond: number): string {
  if (pixelsPerSecond <= 40) {
    return "Very slow";
  }

  if (pixelsPerSecond <= 60) {
    return "Slow";
  }

  return pixelsPerSecond <= 80 ? "Medium" : "Fast";
}

// The clock: the TV's local time in UK 24-hour form, "07:05".
export function formatAmbientClock(date: Date): string {
  const pad = (value: number) => (value < 10 ? `0${value}` : String(value));

  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// What ambient mode is playing, for "Nothing to show from …".
export function formatAmbientSourceName(settings: AmbientSettings): string {
  if (settings.source === "album") {
    return settings.album ? settings.album.name : "an album (none chosen)";
  }

  return settings.source === "all" ? "all photos" : ambientSourceLabels[settings.source];
}

// "1 min", "30 seconds", "2 hours", "Never", "Off".
export function formatAmbientSeconds(seconds: number): string {
  return seconds < 60 ? `${seconds} seconds` : `${seconds / 60} min`;
}

export function formatAmbientIdle(minutes: number): string {
  return minutes === 0 ? "Off" : `After ${minutes} minutes`;
}

export function formatAmbientStop(hours: number): string {
  if (hours === 0) {
    return "Never";
  }

  return hours === 1 ? "After 1 hour" : `After ${hours} hours`;
}
