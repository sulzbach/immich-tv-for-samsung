# 0023 - The OLED keep-awake

## Context

[Issue #15](https://github.com/rfsmason/immich-tv-for-samsung/issues/15) reports that on a Samsung S90F OLED TV (2025), the TV's own screensaver takes over a slideshow or ambient mode after about two minutes without remote input, even with photos changing every 10 seconds. The app already holds the TV's screensaver off during passive viewing through `webapis.appcommon.setScreenSaver` (ADR 0019), and on the Q950R (a QLED, 2019) that works.

What is documented, and what isn't (checked 3 November 2026):

- **Samsung's OLED Screen Saver.** Samsung's support pages say an OLED TV starts its Screen Saver after the same still image, or no input signal, for 2 minutes, and that it "cannot be disabled"; it "may not activate when viewing Live TV or full-screen videos" ([troubleshooting burn-in](https://www.samsung.com/hk_en/support/tv-audio-video/how-to-troubleshoot-burn-in-or-image-retention-on-your-samsung-oled-tv/), [Logo Detection and Screen Saver](https://www.samsung.com/levant/support/tv-audio-video/how-samsung-oled-tv-displays-are-protected-with-logo-detection-and-screen-saver/)).
- **The developer guide** ([Setting Screensaver](https://developer.samsung.com/smarttv/develop/guides/fundamentals/setting-screensaver.html)) documents `setScreenSaver` and says nothing about OLED.
- **Not documented by Samsung:** that `setScreenSaver` doesn't reach the OLED Screen Saver, or what the OLED one actually watches. A slideshow changing every 10 seconds isn't "the same still image", yet it was interrupted, so the trigger seems to be no remote input and no video playing. Another Tizen photo app, Tessel TV, logged `setScreenSaver(OFF)` succeeding on an OLED TV while the screensaver still appeared at two minutes, and found that playing a hidden looping video kept it away ([tessel-tizen-tv #132](https://github.com/PatrickSt1991/tessel-tizen-tv/issues/132)).

The cause on the reporter's TV is therefore likely, not proven.

## Decision

- **A setting, off by default.** Settings → Display → "Keep OLED screensaver away" (`AppSettings.oledKeepAwake`, schema version 6). Nothing changes for anyone who leaves it off, including every QLED owner, for whom it would do nothing useful.
- **What it does.** While a slideshow or ambient mode shows photos, `src/platform/tizen/keep-awake.ts` plays `assets/keep-awake.mp4`, muted and looping, in a full-screen `<video>` behind everything (`z-index: -1`). The viewer and ambient mode are opaque fixed layers above it, so it is never seen. When nothing needs it, it pauses and unloads its source, so it holds no decoder.
- **Videos show as stills while it is on.** A TV may not play two videos at once, so a real video never plays beside the clip: slideshows show a video's poster for the interval even with Autoplay videos on (`slideshowPlaysVideos`), and ambient mode leaves videos out (`readEffectiveAmbientSettings`). Ambient's Live Photos show their stills too. In Settings, ticking it turns Ambient's Include videos and Play Live Photo motion off and locks them, with a hint saying why; it stays reachable with the remote. Unticking it before saving brings the earlier choice back. Pressing Play on a video still plays it: that pauses the slideshow first, which stops the clip before the video starts.
- **Driven by passive viewing.** Holds in `screensaver.ts` are `photos` (a running slideshow, ambient mode) or `media` (a playing video or Live Photo). The clip is asked to play while a photos hold is active and no media hold is; the setting is read at each change. `setScreenSaver` is still called exactly as before.
- **Logged.** The TV's answer to each `setScreenSaver` call, and every clip start, stop and failure, are logged, so a log from an OLED TV shows which part didn't work.
- **The clip.** 10 minutes of black at 320×180 and 1 frame a second, H.264 Constrained Baseline level 3.0, no audio track, 15 KB, made with ffmpeg 6.0 (`color=c=black:s=320x180:r=1:d=600`, `-tune stillimage`, `-movflags +faststart`). It is the ninth staged runtime file.

## Consequences

- **Unverified on an OLED TV.** It rests on Samsung's "may not activate when viewing … full-screen videos" and on one other app's report. The reporter of issue #15 has offered to test; the setting stays off by default until that's confirmed, and possibly after.
- **It works around a burn-in protection on purpose.** That is why it is opt-in, and why it only plays while photos change: a paused slideshow, the viewer at rest and every other screen release it, so the OLED Screen Saver still protects static screens.
- **Auto Power Off.** A TV might count the playing clip as activity. Ambient mode's Stop after still ends the hold; with Stop after set to Never, the TV might stay on longer than its owner expects.
- **Store builds.** Samsung asks apps to use `setScreenSaver`; a certification reviewer might see the clip as circumventing a platform protection. Reconsider before any store submission (Milestone 20).
- **Cost.** One 15 KB file, one video element created only when first used, and a little decoder work while it plays.

## Later

- If an OLED TV confirms it works, consider whether real videos can play in slideshows with it on (stopping the clip during each video), and whether the TV model can be read to suggest the setting.
- If it doesn't work, remove it rather than keep an option that does nothing.
