# 0019 - Ambient mode and the TV screensaver

## Context

Milestone 18 asks for an ambient photo-frame or screensaver experience built on the existing viewer and slideshow, with bounded resource use over long sessions (hours, and overnight). The brief asks first whether the app can act as the TV's real screensaver, or should be an in-app ambient mode. Separately, the app never told the TV when the user was watching without pressing keys, which Samsung requires of store apps. The target remains the Samsung QE55Q950RBTXXU (2019, Tizen 5.0, Chromium 63). Milestone 17 is parked, so this ADR takes number 0019.

## Investigation (26 October 2026)

### The TV screensaver

- **Samsung's "Setting Screensaver" guide** ([developer.samsung.com](https://developer.samsung.com/smarttv/develop/guides/fundamentals/setting-screensaver.html)):
  - the TV screensaver prevents burn-in, and appears after a period without input;
  - apps switch it with `webapis.appcommon.setScreenSaver(state, onsuccess?, onerror?)`, where `state` is `webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF` or `SCREEN_SAVER_ON`;
  - **apps published to Samsung's store must disable it during passive viewing**, "such as video playback or image slideshows", and enable it when playback pauses or stops;
  - the calls have no effect when "Auto Protection Time" is off in the TV's settings.
- **AppCommon API reference** ([developer.samsung.com](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/appcommon-api.html)):
  - `void setScreenSaver(AppCommonScreenSaverState state, optional SuccessCallback? onsuccess, optional ErrorCallback? onerror)`;
  - since product API 2.3, on TV and B2B, which covers Tizen 5.0;
  - `SCREEN_SAVER_OFF = 0`, `SCREEN_SAVER_ON = 1`;
  - it can throw `TypeMismatchError`;
  - **no privilege is listed**, here or in the Samsung Product API index ([developer.samsung.com](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references.html)). `config.xml` is unchanged.
  - `webapis` comes from `<script src="$WEBAPIS/webapis/webapis.js"></script>` in `index.html`.
- **Samsung's Smart TV FAQ** ([Other Features, Q6](https://developer.samsung.com/smarttv/develop/faq/other-features.html)) repeats that apps use AppCommon to enable and disable the screensaver. It says nothing about Ambient Mode, keeping the screen on, or Auto Power Off.

### A third-party Ambient Mode or screensaver app

- No public SDK, manifest setting or registration exists for a third-party Tizen web app to act as the TV's screensaver or to appear in Samsung's Ambient Mode, on Tizen 5.0 or later:
  - Samsung's 20 Product APIs include none for it; AppCommon only defines an "Ambient" key name (since Tizen 4.0) among its key names.
  - Samsung's support pages describe Ambient Mode as a user feature showing Samsung's own content, with no developer route.
  - A Samsung developer-forum thread that discussed it ("Developing Ambient mode") now returns 404, and searches found nothing else.
- **Conclusion: in-app ambient mode, plus correct control of the TV's own screensaver.** If Samsung opens a screensaver or Ambient Mode route, this decision can be revisited (see Later).

### Other power controls

- `tizen.power.request("SCREEN", "SCREEN_NORMAL")`: Tizen's Power guide says the Power API is supported in mobile and wearable applications only. It isn't used.
- Nothing documented lets an app change the TV's "Auto Power Off", and it shouldn't. "Stop after" (below) hands back to the TV's own power saving instead.

## Decision

### Passive viewing (`src/platform/tizen/screensaver.ts`)

- `createPassiveViewing({ logger })` returns a reference counter. Each user calls `createHold()` and then `hold.set(active)`. A hold counts once however often it repeats itself.
- The TV is told only when the count crosses zero: `SCREEN_SAVER_OFF` when the first hold becomes active, `SCREEN_SAVER_ON` when the last one ends. Several things can be passive at once: a slideshow, a playing video, ambient mode.
- With no `webapis` (desktop preview, tests), it does nothing. A failure, thrown or reported through the error callback, is logged once and never reaches callers. If the enum is missing, the documented values (0 and 1) are used.
- **Where holds are taken:**
  - **The viewer** holds while it is open and a slideshow runs or a video or Live Photo motion plays (`syncPassiveViewing`, re-read on slideshow start and pause, the video's `playing`, `pause`, `ended` and `emptied` events, close, suspend and destroy). Pausing, finishing, closing the viewer, or the app being hidden (which suspends playback) releases it. Nothing resumes on its own when the app returns, so nothing re-holds then.
  - **Ambient mode** holds for as long as it runs (see below).
- `main.ts` creates the one instance and the application passes it to the screens that need it.

### Loading `webapis.js`

- `index.html` carries Samsung's documented tag, `<script src="$WEBAPIS/webapis/webapis.js"></script>`, before `scripts/main.js`. The TV's web runtime resolves `$WEBAPIS`.
- A desktop browser would request `/$WEBAPIS/webapis/webapis.js` and get a 404, so the desktop preview server (`scripts/serve-preview.mjs`) removes the tag when it serves `index.html`, as it already adds the preview-only script. The preview, the capture tooling and Playwright checks see no 404 and no console error.
- `npm run check` fails if the tag is missing or comes after `scripts/main.js`.
- **The staged widget still holds 7 runtime files**: `webapis.js` is provided by the TV, not packaged. (Later additions brought it to 9; the OLED keep-awake clip is the ninth, ADR 0023.)

### Immich behaviour (verified on 26 October 2026, `main` at `f7b8ae5`)

- **`POST /search/random`** (`search.controller.ts`) needs `Permission.AssetRead` and returns an array of assets.
  - Its body takes the structured `filter`, `size` (an integer from 1 to 1000, default 250), and `withExif`, `withPeople` and `withStacked` (`RandomSearchBaseSchema`, `search.dto.ts`).
  - `searchRandomV3` (`search.service.ts`) resolves its scope with `resolveSearchScopeV3`, as `/search/metadata` does. That scope is your own assets plus those of partners whose "Show in timeline" is on (`getUserIdsToSearch`). A filter confined to albums covers those albums' whole contents instead, and `AlbumRead` is checked on each album.
  - The repository orders by `random()` with a `LIMIT` (`searchRandomV3`, `search.repository.ts`). Each call is an independent draw, so calls can return the same assets again.
- **Favourites.** `isFavorite` is each owner's own flag, so a random draw filtered by it could return a partner's favourites (ADR 0016, ADR 0018). Timeline buckets with `isFavorite` and no `withPartners` cover only your own assets; Immich refuses `isFavorite` together with `withPartners` (`timeline.service.ts`).
- **Memories.** The existing `GET /memories` request (today's date, up to 20) returns covers. `GET /memories?id=…` returns one Memory's assets in order, as the app already uses them.
- **Permissions:** no new ones. Ambient mode uses `asset.read` (random draws and timeline buckets), `album.read` (an album source and its picker), `memory.read`, and `asset.view` (previews and video).

### Sources (`src/app/ambient-sources.ts`)

Every source has one interface, `next(): Promise<AlbumAsset | null>`, and holds only a bounded look-ahead.

| Source | How it's sampled |
| --- | --- |
| **All photos** (default) | Random draws of 20 from the timeline (not trashed, timeline visibility): photos only (`type` IMAGE), or photos and videos. |
| **Favourites**, your own only | Lists your favourite timeline buckets once. Each time, picks a bucket weighted by its count, loads only that bucket, and picks within it. All favourites are never loaded. |
| **Recent** | Random draws limited to `takenAt` in the last 90 days. |
| **Album** | Shuffled: random draws with `albumIds.any`. In order: the album's paged feed, oldest first, starting again after the last page. |
| **Memories** | Today's Memories, as Home shows them. In order: Memory by Memory. Shuffled: a random Memory, then a random picture in it. Only the Memory being shown keeps its assets. |

- **Repeat avoidance.** A ring of the last 200 shown asset ids (`createRecentRing`) is skipped when drawing. A draw is retried up to three times. A small source (a draw smaller than asked for, or a bucket or Memory with nothing new) repeats rather than stopping, and an empty source answers null.
- **Media.** Photos only by default, or photos and videos. Live Photos are photos and show their still.
- **Partners.** The random sources may include timeline-enabled partners' photos. That matches Photos, so it is accepted. Favourites stays your own.

### Presentation (`src/screens/ambient/`)

- **A full-screen surface above everything** (`#ambient-screen`), with route `{ kind: "ambient"; returnTo }`. The screen beneath is left as it is, so ending ambient mode returns to it exactly.
- **No new media engine.** Pictures go through the viewer's bounded image window (`asset-viewer-window.ts`: preview loading, at most three requests in flight, revoking anything outside the window) and the shared media helpers (`media-elements.ts`).
- **The playlist holds at most three assets:** the outgoing one while it fades, the current one, and the next, preloaded.
  - **Crossfade** between two `<img>` layers by CSS opacity alone (1.5 s; no filters, no transforms). The incoming picture is shown only once it has decoded, waiting at most 5 s.
    - Only the incoming layer animates. It fades in on top, on black, while the outgoing picture stays fully opaque beneath it. Fading both layers at once let the black background show through mid-fade (two half-transparent layers cover only three quarters), which on the TV read as a black frame between pictures.
    - "Decoded" means `HTMLImageElement.decode()` where the browser has it (newer than Chromium 63), and the load event alone on Tizen 5.0.
    - The fade ends when the browser reports it (`transitionend`), or at the latest 1 s after its length (`ambientFadeGraceMs`). On the TV a fade can start late, and ending it on a 1.5 s timer cut it short with a visible jump.
  - **The outgoing layer** is cleared, and its preview URL revoked, as soon as the fade ends.
  - So at most two pictures are ever decoded on screen, and at most three preview URLs are held.
- **Pictures are shown whole** (`object-fit: contain`) on black, so faces at the edges are never cropped.
- **Interval:** 10 s, 20 s, 30 s (default), 1 min, 2 min or 5 min.
- **Videos** play muted in a single `<video>` over their poster, until they end or for at most 60 s (`ambientVideoCapMs`), then the next picture fades in over the video, paused on its last frame. The video is released once the fade ends, not as it starts, so it never disappears from under the incoming picture.
- **Overlays:**
  - a clock, on by default: the TV's local time in UK 24-hour form ("07:05");
  - photo details, off by default: the date, and the place when the photo has one, from the viewer's metadata formatting.

  Both are small and low-contrast.
- **Burn-in care.** The overlays move between four places inside the safe area every three minutes (`ambientOverlayMoveMs`), so nothing static stays put for long. The pictures themselves change at every interval.

### Starting and stopping (`src/app/ambient-controller.ts`)

- **Start now** in Settings → Ambient plays with the section's current choices, saved or not.
- **Start after idle** (Off by default; 5, 10, 15 or 30 minutes) uses one timer, restarted by any key. When it fires, ambient mode starts only over a browsing screen: Home, Photos, Albums, Search, and the collections opened from them. It never starts over the splash, Settings, a picker, the exit question, the viewer (so never during a slideshow or playback), or Search while a date, list or Clear all question is open. Otherwise the timer simply starts again.
  - An idle start is quiet: nothing shows until the first picture is ready. If the source is empty or the server can't be reached, ambient mode doesn't start, and the timer starts again.
- **Any key exits** and returns exactly where you were: the same screen and the same focused control (or the screen's default control if that one has gone). **The key is consumed and does nothing else**, and its key-up is swallowed too. The listener is on the window in the capture phase, ahead of every document listener, including the shell's root Back. So **Back never shows the exit question from ambient mode**. A screensaver must never act on the first key press.
- **Stop after** (Never by default; 1, 2 or 4 hours) ends ambient mode on a deadline and returns where you were. Ending releases the passive-viewing hold, so the TV's own screensaver, and its power saving after that, can take over overnight.
- **The app hidden** (Home on the remote): ambient mode stops and releases its media, timers and hold.
  - Shown again, a manual start resumes with the same choices and the same Stop after deadline.
  - An idle start returns to where you were.
  - The idle timer is cleared while hidden.

### Errors and long runs

- **A picture that fails to load is skipped.** After five failures in a row (`ambientMaxConsecutiveSkips`), or when the source itself fails, ambient mode shows a calm message on a dark screen, "Can't reach your Immich server. Trying again…", and retries after 15 s, doubling up to 5 min (`ambientBackoffStartMs`, `ambientBackoffMaxMs`). It resumes on its own when the server answers.
- **An empty source** shows "Nothing to show from <source>. You can change it in Settings → Ambient." when started manually.
- **Resource bounds:**
  - Two image elements and one video element, created once.
  - At most three preview URLs.
  - A recent-id ring of 200.
  - One bucket's or one Memory's assets.
  - A look-ahead of one draw (20).
  - A fixed set of timers, each owned by a timer group that is cleared on exit, hide and destroy.
  - Listeners added once at mount.

  A test runs ambient mode for 8 simulated hours over more than 2,000 pictures. Live URLs stay at three or fewer, displayed pictures at two or fewer, and timers at five or fewer. Everything returns to zero on exit.

### Settings → Ambient (`src/screens/settings/ambient-section.ts`)

- **Controls:**
  - Source, Album (shown for Album) and Order (Shuffle or In order, shown for an album and Memories);
  - Interval, Start after idle and Stop after, using the shared drop-down (which opens on OK);
  - Include videos, Show clock and Show photo details, using the existing On/Off pattern;
  - Start now.
- **The album** comes from the album picker in a new **single-select** mode: OK chooses at once, and Back leaves the choice as it was. Settings comes back as it was left, unsaved choices included.
- **Storage.** Everything is stored in `AppSettings.ambient`, and the settings schema moves to version 2. Version 1 files load with ambient defaults, and unknown values fall back safely.
- **Home and the rail are unchanged.** Ambient mode is not a Home rail, and there is no new rail destination.

### Long timers (TV finding, 27 October 2026)

- **What was seen.** On the Q950R, Start after idle (10 minutes or more, on Home) never started ambient mode, though the same settings worked in the desktop preview and Start now worked on the TV. Nothing else in the idle path differs between the two, so the likely cause is the single long `setTimeout` the countdown used, which the TV's runtime appears not to fire.
- **Not confirmed by Samsung.** Samsung documents nothing about long timers on Tizen TV. Tizen developer-forum reports describe long `setTimeout` delays not firing reliably on other Tizen devices.
- **The fix doesn't depend on the cause.**
  - **Idle and Stop after** are measured against the wall clock (`Date.now()`) from the last key or the start, and checked at least every 30 seconds (`ambientCheckMs`).
  - **Ambient mode's own waits** (interval, video cap, overlay moves, backoff) do the same through `createAmbientTimers` (`ambientTimerStepMs`).
  - No timer longer than 30 seconds is ever set, and a late check still acts as soon as the time has passed.
- **Logging.** The controller logs when an idle start begins, is skipped (not a browsing screen) or finds nothing to show.
- **Confirmed on the TV** on 27 October 2026 (user confirmation): Start after idle, a 5-minute interval and Stop after all work.

## Consequences

- **Store readiness.** Slideshows and video playback now hold the TV's screensaver off and let it back when they pause or stop, as Samsung requires. Testing this on the TV needs "Auto Protection Time" on.
- **Samsung OLED TVs** have a separate burn-in Screen Saver that this switch has been reported not to reach. An opt-in keep-awake answers that ([ADR 0023](0023-oled-keep-awake.md)).
- **Single source of truth for media.** Ambient mode adds a presentation, not an engine: preview loading, retention and release are the viewer's.
- **The viewer split.** It was needed to reuse this code. `asset-viewer.ts` went from 972 lines (998 after Phase 1) to 864 (ADR 0005 update).
- **No framework, router, event bus, animation library or dependency.** The CSS uses opacity transitions only, and both compatibility checks pass.
- **Physical Q950R acceptance passed** on 27 October 2026 (user confirmation), covering every item on PR #5's checklist, including the overnight soak test.

## Later

- Ken Burns or slow pan effects, if Tizen 5.0 performance allows (measure first).
- A person as a source.
- A schedule (for example evenings only).
- Becoming the TV's real screensaver or an Ambient Mode app, should Samsung open a route for third-party apps.
