import { describe, expect, it } from "vitest";
import {
  defaultAppSettings,
  readEffectiveAmbientSettings,
  slideshowPlaysVideos
} from "./app-settings";

describe("the OLED keep-awake's effect on videos", () => {
  it("lets a slideshow play videos only with autoplay on and the keep-awake off", () => {
    const play = (autoplayVideos: boolean, oledKeepAwake: boolean) =>
      slideshowPlaysVideos({ ...defaultAppSettings, autoplayVideos, oledKeepAwake });

    expect([play(true, false), play(true, true), play(false, false), play(false, true)]).toEqual([
      true,
      false,
      false,
      false
    ]);
  });

  it("keeps ambient mode to photos, and Live Photos still, while the keep-awake is on", () => {
    const ambient = {
      ...defaultAppSettings.ambient,
      includeVideos: true,
      intervalSeconds: 60,
      livePhotoMotion: true
    };

    expect(
      readEffectiveAmbientSettings({ ...defaultAppSettings, ambient, oledKeepAwake: true })
    ).toEqual({ ...ambient, includeVideos: false, livePhotoMotion: false });
    expect(
      readEffectiveAmbientSettings({ ...defaultAppSettings, ambient, oledKeepAwake: false })
    ).toBe(ambient);
  });
});
