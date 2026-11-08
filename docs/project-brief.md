# Project Brief

This document is the authoritative high-level product brief and roadmap for Immich TV for Samsung. Standing engineering instructions, compatibility constraints, architecture rules, testing requirements, and implementation practices live in `AGENTS.md`. Milestone-specific architecture decisions live in `docs/architecture/`.

## Goal

Build a native-feeling Samsung Tizen TV client for Immich.

The app should be:

- TV-first and usable with the Samsung Smart Remote.
- Read-only at first.
- A dedicated Tizen Web Application, not a wrapper around Immich Web.
- Compatible with the Samsung QE55Q950RBTXXU, a 2019 Tizen 5.0 TV with a Chromium M63 web engine.

## Product Shape

Immich TV is a sofa-friendly viewer for an existing Immich library. Immich remains the system of record for authentication, library data, albums, assets, thumbnails, previews, videos, transcoding, people, memories, search indexing, and storage management. The TV client presents those capabilities through a remote-first television interface.

The product should grow from a stable viewing foundation into a broader TV-native browsing experience: startup shell, Home, Photos, Albums, Memories, People, Search, Favorites, shared content, ambient playback, and consumer-friendly pairing.

## Cross-Roadmap TV UX Principles

The application UI should follow established Smart TV design principles throughout the roadmap:

- **Design for the 10-foot experience.** Text, focus states, and controls must remain readable from normal sofa distance. Body-size interface text should not fall below the current TV-safe scale, and screens should be checked on the physical QE55Q950R rather than judged only from a desktop monitor.
- **Prefer simple, low-clutter screens.** Each screen should have one clear purpose, generous spacing, and limited simultaneous choices. Text density should stay low; albums and assets should remain visual-first.
- **Use deterministic remote navigation.** Up/Down/Left/Right/OK/Back must have predictable outcomes. Focus must always be visible, and top-level navigation should be reachable without hidden mouse, hover, or keyboard assumptions.
- **Avoid duplicate location chrome.** When the persistent rail clearly communicates the active top-level destination, top-level screens should not repeat that destination as a large heading unless it adds meaning. Keep local headings for content-specific child screens, such as a selected album name, and for form-heavy screens such as Settings.
- **Respect safe areas and overscan.** Functional controls, text, and focus indicators must stay comfortably inside the 1920x1080 TV canvas. Decorative backdrops may extend toward edges, but essential UI must not rely on edge pixels.
- **Use TV-safe colour and contrast.** UI colours should work on default television picture settings, avoid harsh oversaturation, and maintain clear contrast in bright and dark rooms.
- **Treat the TV as a shared device.** Avoid unnecessarily surfacing sensitive account or credential details. Settings and diagnostics should not expose secrets from across the room.
- **Design for the whole household.** Navigation, labels, focus states, and errors should be usable by children, older users, and less technical family members, not only by the developer.

## Milestones 1-7 - Core Viewing Foundation

1. **Minimum deployable Tizen application - complete**
   Deploy the smallest possible Samsung Tizen Web Application to the physical QE55Q950R and prove the toolchain, packaging, signing, installation, launch, and logging loop.

2. **Immich connectivity and configurable credentials - complete**
   Support configurable Immich server URL and API key, persist connection settings, and prove authenticated Samsung TV to Immich API communication.

3. **Permanent TypeScript/Tizen application foundation - complete**
   Establish the production application structure: TypeScript modules, Chromium M63 build target, tests, linting, type checking, CI, Tizen packaging, logging, storage, platform boundaries, and separated Immich API access.

4. **Albums - complete**
   Retrieve Immich albums and display them in a TV-friendly grid with deterministic Samsung remote navigation.

5. **Album asset browsing with bounded resources - complete**
   Open albums, retrieve paginated assets, display a bounded/virtualised thumbnail grid, represent image/video/Live Photo assets, and preserve predictable remote focus.

6. **Full-screen asset viewer - complete on main**
   View album assets full-screen with Left/Right navigation, Back to the asset grid, bounded preview loading, metadata overlays, video poster stills, video playback, Live Photo playback, and shared viewer controls.

7. **Slideshow - complete**
   Add slideshow mode over the full-screen viewer with configurable interval, automatic next asset, pause/resume, predictable manual navigation behaviour, Back/exit handling, and bounded media resource usage.

## Current Scope / Status

The current `main` branch contains Milestones 1-16 and 18: deployable Tizen app, Immich connectivity, TypeScript application foundation, albums, bounded album asset browsing, a full-screen asset viewer with image, video, and Live Photo support, slideshow mode with configurable interval, pause/resume, viewer control refinements, settings-screen rationalisation, startup splash, the permanent top-level application shell, the Photos / main timeline experience, Home, Memories, foundation hardening (Chromium 63 compatibility enforcement, request timeouts, lifecycle and exit handling, and the structural refactor), the Home polish (paged Home collections, fixed-focus rails, and See more), People, Search v1, Favorites and Library Views, Personalisation and Navigation, Search v2, and Ambient / Screensaver Mode.

The application remains read-only.

Milestone 10, Home, is complete on `main`; physical-TV acceptance of the six rails passed on 16 October 2026 (user confirmation, covered by the Milestone 11.5 acceptance checklist). Home is the normal startup destination when valid Immich connection settings exist.

Milestone 11, Memories, is complete on `main`; physical Q950R acceptance passed on 16 October 2026 (user confirmation, covered by the Milestone 11.5 acceptance checklist). It adds a scrolling current-Memories child destination under Home and reuses the shared asset grid, viewer, slideshow, and playback.

Milestone 11.5, Foundation Hardening and Structural Refactor, is complete on `main` (see [ADR 0012](architecture/0012-foundation-hardening.md)); physical Q950R acceptance passed on 16 October 2026 (user confirmation).

Milestone 12, People, is complete on `main` (see [ADR 0013](architecture/0013-people.md)); physical Q950R acceptance passed on 26 October 2026 (user confirmation), run together with Milestones 13-15. It adds a paged People browser under Home, reached from the People rail's See more, and opens each person in the shared collection, viewer and slideshow. The seven Milestone 11.5 carry-over tidy-ups are done.

Milestone 13, Search v1, is complete on `main` (see [ADR 0014](architecture/0014-search.md)); physical Q950R acceptance passed on 26 October 2026 (user confirmation). Search replaces the placeholder with a remote-first criteria panel (people, From and To dates), a people picker, and results in the shared collection, viewer and slideshow.

Development tooling: desktop screenshot and video capture against a demo library ([docs/capture.md](capture.md), [ADR 0015](architecture/0015-desktop-back-key.md)). It is not a milestone and does not replace physical-TV acceptance.

Milestone 14, Favorites and Library Views, is complete on `main` (see [ADR 0016](architecture/0016-library-views.md)); physical Q950R acceptance passed on 26 October 2026 (user confirmation). Favourites, Videos (a new Home rail) and Recently added open as library views in the shared collection, viewer and slideshow.

Fixes from TV testing (picker face flicker, a sharper launcher icon, an earlier splash with Home revealed once its rails have loaded, and Home loading in screen order) are on `main` (PR #2); their physical-TV checks passed on 26 October 2026 (user confirmation).

Milestone 15, Personalisation and Navigation, is complete on `main` (PR #3, see [ADR 0017](architecture/0017-personalisation-and-navigation.md)); physical Q950R acceptance passed on 26 October 2026 (user confirmation), including every item on PR #3's combined checklist. It adds date-rail hold acceleration and CH year jumps, Home rail visibility in Settings, a Newest first / Oldest first toggle on collections, viewer face tags, a standard background, and partners' photos in Photos and Recently Added.

Milestone 16, Search v2, is complete on `main` (PR #4, see [ADR 0018](architecture/0018-search-v2.md)); physical Q950R acceptance passed on 26 October 2026 (user confirmation), covering every item on PR #4's checklist. Search adds an Asset type drop-down beside the dates (All, Photos, Live Photos, Videos), a place picker (country, region, city) and an album picker, all chosen with the remote.

Milestone 17, Shared Content, is parked by the user's decision (26 October 2026): deferred, not cancelled. Its section below and its success criterion stay for later.

Milestone 18, Ambient / Screensaver Mode, is complete on `main` (PR #5, see [ADR 0019](architecture/0019-ambient-mode.md)); physical Q950R acceptance passed on 27 October 2026 (user confirmation), covering every item on PR #5's checklist, including the overnight soak test, and the later button restyling and auto-hiding viewer buttons were confirmed on 28 October 2026. Slideshows, playback and ambient mode now hold the TV's own screensaver off as Samsung requires, and an in-app ambient mode plays All photos, your own Favourites, Recent, an album or Memories, started from Settings → Ambient or after an idle time. The roadmap continues after it with Consumer-Friendly Pairing and Authentication, and Product Hardening and Samsung Release Readiness (Milestones 19 and 20; renumbered on 23 October 2026 when Milestones 15 and 16 were added).

Milestone 18.5, Viewing and Accessibility Polish, is complete on `main` (PR #6, see [ADR 0020](architecture/0020-viewing-and-accessibility.md)); physical Q950R acceptance passed (user confirmation, 30 October 2026). By the user's decision (28 October 2026) it took priority over Milestones 17 (parked), 19 and 20; it is numbered 18.5, following Milestone 11.5, so nothing is renumbered.

## Post-MVP Product Roadmap

### Milestone 8 - Application Shell, Splash and Top-Level Navigation - complete

Create the permanent application-level navigation model before the number of first-class screens grows further.

Add a polished Immich TV splash/startup experience. The splash screen should render immediately on launch, provide clean Immich TV branding, act as the visible state while settings and startup state are restored, route to the normal application as soon as valid configuration exists, route to setup as soon as configuration is missing or unusable, and surface understandable startup/reconnect failure rather than hanging indefinitely.

#### Support reminder on splash

The splash screen may include a small, understated message reminding users that the app is free to use and can be supported voluntarily.

The support message must:

- Not delay application startup.
- Not introduce any artificial splash-screen wait time.
- Not block or require user interaction.
- Not be focusable.
- Not behave like an advertisement or modal.
- Remain visually secondary to the Immich TV branding.
- Use calm, non-pressuring language.
- Direct users to the Settings / Support Development area for any actual donation action.
- Not display donation prices or purchase controls on the splash itself.

Suggested wording:

- "Enjoying the app? You can support development in Settings."
- "Free to use. Supported by people who enjoy it."

If the application can determine that the user has previously made a voluntary support purchase, the splash message should change to a thank-you acknowledgement instead of continuing to solicit support, for example:

- "Thank you for supporting Immich TV."

This acknowledgement should remain subtle and must not affect startup timing. The intent is to create a gentle visual reminder during an already-existing startup state, not to introduce an additional monetisation screen.

The actual donation/support flow belongs in Settings / Support Development and should be implemented separately from the splash presentation.

**Settings › Support Us (1 November 2026, [ADR 0021](architecture/0021-support-us.md)).** The support area is Settings › Support Us, after Ambient. It shows the tip page `https://ko-fi.com/immichtv` as a QR code and the short address `ko-fi.com/immichtv`, the suggested tips (£5 a coffee, £10 lunch, £20 dinner; any amount is appreciated) and an honour-based toggle, "I've already supported Immich TV". The TV never pays or contacts Ko-fi, and tipping unlocks nothing. The splash now reads "Free to use. You can support development in Settings.", or "Thank you for supporting Immich TV." once the toggle is on, set from the restored settings before the first paint. Support Us and the splash line exist only in sideload builds; a store build shows neither (see Milestone 18's distribution note).

Establish top-level navigation for the intended primary destinations:

- Home
- Photos
- Albums
- Search
- Settings

People and Memories may be reached through Home/Search or later promoted to primary destinations if TV usability proves that preferable.

Success criterion: the application has a polished startup experience and a navigation shell capable of supporting the rest of the roadmap without bolting unrelated screens onto the original Albums-first navigation.

### Milestone 9 - Photos / Main Timeline - complete

Add a first-class Photos experience for browsing the user's general Immich library without requiring assets to belong to an album.

Implement chronological library browsing, newest-first default presentation unless current Immich behaviour strongly suggests otherwise, useful date grouping or date context, efficient API pagination, virtualised/windowed rendering, bounded thumbnail resources, consistent image/video/Live Photo representation, reuse of the existing full-screen viewer, and reuse of slideshow functionality.

This milestone should establish reusable application/domain infrastructure for general asset collections so later Home, Search, People, Favorites, and other filtered views do not each invent their own asset-grid implementation.

Success criterion: a realistically large Immich library can be browsed chronologically from the TV with bounded resource usage and the existing viewer/slideshow experience.

### Milestone 10 - Home - complete

Make Home the normal landing screen after successful startup.

The implemented Home preview contains these bounded horizontal rails in order:

1. Recently Added — newest date added to Immich first.
2. Favourites.
3. People.
4. Recently Viewed — actual local TV viewing history, newest viewed first.
5. Albums.
6. Memories.

Each rail contains at most 18 items. Lower rails scroll into view with remote focus. Selecting an asset opens the shared summary grid on that asset, which lazy-loads the rail's full collection (ADR 0009 update), then the shared viewer; selecting an album reuses album detail. These previews do not replace the later first-class People, Memories, or Favourites browsing milestones.

All six Home rails and the People loading/retry flow are implemented, and physical-TV acceptance passed on 16 October 2026. Recently Viewed now records viewer entry and navigation across all sources, persists a bounded history scoped to server/user, and revalidates assets before display. It opens a bounded ordered history collection; resuming the original paginated browsing context remains a separate Continue Browsing feature.

Build a reusable TV rail pattern where Up/Down moves between rails, Left/Right moves within a rail, focus remains obvious, lazy loading does not lose focus, each rail has bounded DOM/image/resource use, selecting an asset reuses the normal viewer, and selecting an album reuses the normal album flow.

Success criterion: launching the application leads to a useful, polished overview of the user's library rather than directly into Albums.

### Milestone 11 - Memories - complete

Add first-class support for Immich Memories. Immich remains responsible for determining and generating memories; the TV client must not recreate memory-generation logic.

Support retrieving current Memories through the documented Immich API, surfacing Memories on Home, opening a Memory, displaying title/date/context where available, navigating its assets, viewing assets using the existing viewer, and slideshow/playback using the existing viewer infrastructure.

Implemented behaviour:

- Home retains its 18-card preview of Memories available for the current local calendar date. A View all Memories tile at the end of that rail opens a child summary using the same five-column square-card layout as Albums. There is no separate Home button or summary navigation toolbar.
- Discovery maps only covers and summary metadata; opening a Memory revalidates its ID with Immich search, preserving discovery's hidden-person filtering and the server's ordered asset sequence.
- Memory grids use the existing shared collection controller. Images, videos, Live Photos, slideshow, viewer Back, and asset focus restoration all use the existing paths. Grid Back returns to Home for a preview entry or to the originating browser card for a browser entry.
- Local viewing history records a `memory` source in the existing backward-compatible version 1 store.
- The summary initially fills three rows, then loads more near the focused row. It retains at most three pages (45 summaries), windows the DOM and thumbnails, and reloads earlier pages when moving back up. Covers are released outside retention and on hide/reset/destroy. Connection changes clear the browser cache.
- The summary uses the documented Memories statistics count to bound lazy loading even though the server filters empty Memories after paging. This requires the read-only Memories statistics permission. Current suggestions only; saved/historical filters are deferred. Embedded assets cannot be paged independently by this API; an unusually large manually assembled Memory can still produce a large metadata response. Media and DOM retention stay windowed.

Architecture and verified API references: [ADR 0011](architecture/0011-memories.md).

Success criterion: a user can discover a suggested Immich Memory from Home and comfortably view it on the television.

### Milestone 11.5 - Foundation Hardening and Structural Refactor - complete

#### Intent

Milestones 1-11 delivered a working, well-bounded viewer, but a full codebase review on 15 October 2026 (at `main` `dd46ee9`) found two probable Chromium 63 runtime defects, a gap in how compatibility is enforced, several robustness gaps, and structural debt concentrated in a few very large modules.

People (M12), Search (M13) and Favorites (M14) will all build on the shared collection grid and viewer. This milestone pays down that debt first, so those features land on a foundation that is correct on the TV, enforced by the build, and small enough to change safely.

This is a hardening and refactoring milestone, not a feature milestone:

- No new user-facing destinations or Immich capabilities.
- Behaviour visible to the user must be preserved, except where an item below explicitly corrects a defect.
- Each refactor must be behaviour-preserving and covered by tests before and after the move.
- Work should land in small, coherent commits or PRs in the order given below, so the app stays deployable throughout.

#### Baseline at review

- Typecheck, lint, build, static checks and Tizen staging pass; 253 tests pass across 24 files.
- Statement coverage is about 53%. Pure helpers are at 84-96%, but some screens are much lower:

| Area | Statement coverage |
|---|---|
| Album detail screen (viewer, slideshow, playback) | 51% |
| App shell | 12% |
| Albums screen | 0% |
| Settings / connection screen | 0% |

- The shipped `dist/scripts/main.js` is 313 KB unminified. Minified it would be about 145 KB (about 36 KB gzipped).

#### Issues to address

**A. Chromium 63 compatibility (highest priority)**

1. **Confirm the actual web engine first.** On the physical Q950R web inspector, record:
   - `navigator.userAgent`
   - `CSS.supports('gap', '1px')`
   - `'toggleAttribute' in Element.prototype`

   Record the results in `docs/toolchain.md`. Treat the TV's answers as authoritative for items A2-A4.
2. **`Element.toggleAttribute` (Chrome 69+).** It is used in `src/screens/connection-screen.ts` (`updateDirtyStatus`) for the Settings unsaved-changes indicator. On Chromium 63 it would throw whenever the dirty state updates. Replace it with `setAttribute`/`removeAttribute` and add a Settings test that would catch the regression.
3. **Unprefixed CSS `gap` (grid: Chrome 66+; flexbox: Chrome 84+).** `styles/main.css` has about 57 `gap` declarations and no `grid-gap` fallback.
   - Grid containers need `grid-gap` alongside `gap`.
   - Flex containers need margin-based spacing, because flex `gap` has no Chromium 63 equivalent.

   The virtualised grid spacer heights (`--album-grid-gap`, `--asset-grid-gap`) and the JavaScript tile sizing that reads `columnGap` must remain consistent with the spacing actually rendered.
4. **Enforce compatibility in the build, not just syntax.** Today esbuild's `chrome63` target only transpiles syntax. Meanwhile `tsconfig` includes the full modern `DOM` type library, and lint has no browser-compatibility rule.
   - Add a Chrome 63 browserslist target and an API compatibility lint rule, for example `eslint-plugin-compat`. Vet its accuracy and maintenance as section 31 of `AGENTS.md` requires.
   - Add a small CSS compatibility check that fails on known-unsupported properties without fallbacks (at minimum `gap` without `grid-gap`, `inset`, `aspect-ratio` and flex `gap`).
   - Both checks run in `npm run lint` and CI. This satisfies section 23 of `AGENTS.md`.
5. Note: `focus({ preventScroll })` is silently ignored on Chromium 63, since the option needs Chrome 64. Existing code already corrects scroll manually. Document this as a known platform behaviour rather than relying on the option.

**B. Network and error robustness**

1. **No request timeouts.**
   - `requestJson` and `requestBlob` in `src/api/immich/client.ts` can hang forever on a stalled connection, leaving a loading state with no Retry.
   - `AbortController` is not available on Chromium 63 (it needs Chrome 66), so implement a bounded timeout race that rejects with a typed network or timeout `AppError`.
   - Late responses must be ignored by the existing generation guards.
2. **Every 403 is reported as "Immich rejected the API key".** A key that is valid but lacks one permission (for example People) gets a misleading message. Add a distinct permission error kind. Map it to a household-friendly message naming the missing capability where the endpoint is known. Keep 401 as the invalid-key case. The existing special case for Memories statistics should become an instance of the general mechanism.
3. **`AppError` drops `cause`.** The constructor accepts it but never stores it. Preserve it for diagnostics, without exposing it to user-facing messages.
4. **The logger loses `Error` details.** `sanitize()` iterates enumerable keys, so `Error` objects (whose `message`, `name` and `stack` are not enumerable) are logged as `{}`. For example, the startup failure log currently carries no useful information. Serialise errors explicitly while keeping credential redaction.

**C. Tizen application lifecycle and Back behaviour**

1. **No lifecycle handling.** Nothing listens for `visibilitychange` (or the Tizen equivalent verified against Samsung's documentation), so video playback and slideshow timers keep running when the TV backgrounds the app.
   - On hide: pause playback and slideshow.
   - On return: leave them paused and in a predictable state.
   - Implement this behind the existing `src/platform/tizen/` boundary.
2. **Back at the root does nothing.** Back on the left-hand rail is currently ignored. Samsung expects Back at the top level to exit (or confirm exit). Implement this according to current Samsung TV guidance, verified for Tizen 5.0, through the platform abstraction. Keep the existing rule that Back from Settings with unsaved changes is guarded.

**D. Structural refactor**

1. **Split `src/screens/album-detail-screen.ts`.** It is about 3,400 lines and has a single 30-field mutable state object. It currently owns:
   - album, Photos timeline, Home, People and Memory collections
   - paging in both directions and the timeline rail
   - the full-screen viewer, slideshow, video and Live Photo playback, and the random backdrop

   Separate it into, at minimum:
   - a collection grid controller (windowing, thumbnails, focus, paging)
   - a Photos timeline extension (buckets, rail, date sections)
   - a viewer/playback controller (preview window, slideshow, video, Live Photo, metadata)

   The pieces should communicate through narrow typed interfaces. Replace overlapping mode flags (`mode`, `timelineMode`, `source.kind`, `remoteCollection`) with a discriminated union so that contradictory combinations cannot be represented. This must preserve ADR 0008's single shared viewer/collection rule; it is a decomposition, not a duplication.
2. **Consolidate routing in `src/app/main.ts`.** It has a 9-state `ActiveScreen` union, a separate `memoryParent` variable, and about seven `display*`/`show*` functions that each hand-list every screen to hide. Replace these with:
   - a small typed screen registry with a single "show only this screen" operation
   - an explicit parent/back context

   This stays within ADR 0007: no router framework, event bus or global state library.
3. **Shared grid presentation.** The Albums, Memories and Home screens each re-implement tile sizing, spacer creation and focus scrolling. Extract one small shared helper and align `memories-screen.ts` with the project's prevailing code style.
4. **Remove the vestigial Photos placeholder.** The `photos-screen` placeholder section and controller are still mounted and hidden on every transition, although Photos now runs through the shared collection screen.
5. **Move presentation formatting out of the API client.** Month and weekday names and date-label formatting in `src/api/immich/client.ts` belong in domain or presentation code. The client should map to domain values, not display strings.

**E. Build, tooling and reproducibility**

1. **Ship a minified bundle.** Ship `main.js` minified, keeping an explicit unminified debug build option for on-TV diagnosis. Record the resulting size in the PR.
2. **Run `npm run stage:tizen` in CI.** CI does not currently run it.
3. **Add an enforced formatter**, or equivalent style lint, and a `format:check` CI step. `npm run format` is currently only `eslint --fix`, which allowed the style drift in `memories-screen.ts`.
4. **Pin and document toolchain versions.** In `docs/toolchain.md`, pin the Tizen Studio, Tizen CLI, TV Extension and certificate extension versions actually in use, as section 32 of `AGENTS.md` requires.

**F. Test coverage**

Raise coverage where defects are most likely to escape. At minimum add tests for:

- the Settings/connection screen, including dirty state, save, test connection and guarded exit
- the Albums screen
- shell navigation and Back at root
- the routing registry
- the extracted viewer/playback controller
- the timeout and permission error paths

Include a test that asserts no unsupported APIs reach the bundle, if the compatibility lint does not already guarantee it. Set and record a sensible minimum coverage target for the screens, without chasing a number for its own sake.

**G. Documentation drift**

1. The `README.md` "Current Status" still says "Milestone 5 planned" and describes an Albums-first app.
2. `docs/toolchain.md` still contains a note from scaffold time saying `tizen`/`sdb` were "not available on PATH".
3. ADR 0009's validation section quotes 182 tests.
4. Add an ADR for the structural refactor (routing registry, controller decomposition and compatibility enforcement), for example `docs/architecture/0012-foundation-hardening.md`.

#### Out of scope

- People, Search, Favorites and any other new destination.
- Pairing or changes to authentication (Milestone 17, now Milestone 19).
- Visual redesign beyond the spacing corrections in item A3.
- Adopting a UI framework or router library.

#### Acceptance

Passed on the physical Q950R on 16 October 2026 (user confirmation). The three engine console values for the table in [docs/toolchain.md](toolchain.md) are still to be recorded.

- Items A1-A4 are verified on the physical Q950R. Grid spacing, Settings dirty-state indication and save all behave correctly on the TV.
- Compatibility lint fails on a deliberately introduced Chrome 64+ API or unsupported CSS property, and passes on `main`.
- A stalled Immich server produces a timed-out, retryable error state within a bounded time, with focus usable and Back working.
- Backgrounding the app pauses video and slideshow. Back at the root exits as Samsung expects.
- No individual screen module exceeds roughly 1,000 lines without a documented reason. `main.ts` has no repeated hide lists.
- Typecheck, lint (including compatibility), format check, tests, build, static checks and `stage:tizen` all pass in CI.
- Repeated navigation smoke test on the TV (Home → Photos → Albums → Memories → viewer → Back, plus a long slideshow) shows no regressions, missing images or runaway memory symptoms.
- Physical-TV acceptance outstanding from M10 and M11 is completed or explicitly re-recorded as pending.

Success criterion: the app is demonstrably correct on Tizen 5.0 / Chromium 63, compatibility regressions fail the build, network and lifecycle edge cases are handled, and the shared collection and viewer code is decomposed enough that People, Search and Favorites can be added without growing a single module further.

### Milestone 12 - People - complete; physical-TV acceptance passed 26 October 2026

Add first-class browsing by recognised person using Immich's existing facial recognition and People data.

Support a TV-friendly grid/list of recognised people, portrait/face thumbnails where available, assigned names where available, deterministic remote navigation, selecting a person to retrieve that person's assets, and browsing results through the shared asset collection, viewer, and slideshow pipelines.

The TV client must not implement face recognition or person management. Naming, merging, and editing people stays in Immich.

#### Carry-over tidy-ups from the Milestone 11.5 review (16 October 2026)

Complete these at the start of Milestone 12, in small separate commits, before People work depends on them. All seven are done (Milestone 12 branch).

1. **Done - Minimum Immich version.** The app requires Immich v3.2.0 or later:
   - Album detail, Favourites and People use the structured `/search/metadata` request (`filter`/`orderBy`/`cursor`), which was added in v3.2.0. On older servers these fail with a generic error.
   - Document the minimum supported version in `README.md`.
   - During Test connection, compare the server version (already fetched through `getServerVersion`) and show a clear, household-friendly warning when the server is older. Do not block saving.
   - Keep the comparison in the connection service or Immich integration layer, not the UI.
   - Add direct unit tests for `src/app/connection-service.ts`, which currently has none.
2. **Done - Photos timeline search shape.**
   - `buildTimelineAssetSearchBody` still sends the flat fields `page`, `visibility` and `order`, which are deprecated since v3.2.0.
   - Album and Photos pages still read `assets.total`, which is deprecated since v3.0.0.

   Migrate to the structured shape with cursor paging, and stop relying on `assets.total` (use timeline bucket counts or album asset counts where a total is needed). Verify against the current Immich source, write characterisation tests first, and preserve Photos behaviour.
3. **Done - Cursor-only paging for structured searches.** `readNextSearchPage` falls back to the flat `nextPage` token. For structured requests, honour only `nextCursor`. A `page` token there would make `buildFilteredSearchBody` silently refetch the first page, and could loop. Immich currently returns only `nextCursor` for structured requests, so this is defensive: a one-line fix plus a test.
4. **Done - API client size.** As People adds endpoints, split DTO types and validators out of `src/api/immich/client.ts` (about 1,040 lines) into separate integration-layer modules. Endpoint knowledge and mapping stay in the Immich integration layer.
5. **Done - Duration labels in presentation.** Asset duration labels are still formatted in the API client (`asset.duration`). Move them to `src/presentation/`, as was done for date labels in Milestone 11.5 (item D5). The client should map to domain values only.
6. **Done - Consistent month abbreviations.** "Sep" is used throughout. Viewer metadata uses "Sep" and the Photos timeline uses "Sept". Choose one convention and use it in both through the shared presentation helpers.
7. **Done - Viewing-history writes.** The viewer re-records a visit for the current asset whenever paging re-renders it. Record only on an actual selection change. This is harmless today, because history de-duplicates, but it writes storage needlessly and matters more once People and Search use the viewer.

#### Implemented behaviour

- People is a child destination of Home. The People rail ends with See more when Immich has more people than the rail's 18; See more opens the People browser and Back restores the See more tile.
- The browser is a six-column grid of circular faces with names beneath, in Immich's order (favourites, then named people by face count). It loads 30 people per page near remote focus, retains at most four pages (120 people), windows the DOM and faces, and reloads evicted pages when moving back. Loading, empty, error, timeout and Retry states are remote-operable.
- Opening a person, from the rail or the browser, uses the shared collection with the person feed (structured search cursor). The header shows the person's name; no asset count is shown, so no extra API-key permission is needed. Grid Back returns to the originating tile or card; viewer Back returns to the last viewed asset.
- Viewing history records a `person` source in the version 1 store. Hidden people are never requested.

Success criterion: a user can select a recognised person and browse that person's photos/videos comfortably on the TV.

### Milestone 13 - Search v1 - complete; physical-TV acceptance passed 26 October 2026

Add a dedicated Search experience designed for remote control rather than desktop form entry.

Initial search criteria:

- One or more people
- Date from
- Date to
- Combinations of those filters

Search criteria should be represented internally as small composable filters so additional criteria can be added later without building a generic query-builder framework.

Support selecting/clearing people, setting/clearing date boundaries, clearing/resetting search, executing search, useful empty/loading/error states, virtualised/windowed result browsing, shared asset collection infrastructure, and existing viewer/slideshow behaviour from search results.

#### Implemented behaviour

- The Search destination is a criteria panel with three rows: People, Taken (From and To) and actions. People are added in a picker that reuses the People grid; chips show the first four people plus "+N more", and OK on a chip removes it. All selected people must appear in a result ("Photos with all of these people"), up to ten.
- Dates are edited with an inline day/month/year stepper with real month lengths and leap years; OK sets, Back cancels, Clear returns to Any date. From and To are inclusive local days. A reversed range is explained and blocks Show photos; dates are never swapped.
- Show photos opens results in the shared collection with a short criteria summary as the title and a specific empty message. Back returns to Search with the criteria unchanged. Criteria last for the session and clear when connection settings change.
- There is no result count, because Immich's statistics search needs the extra `asset.statistics` API-key permission.
- Viewing history records a `search` source.

Success criterion: a user can find assets for a person, a date range, or both using only the Samsung Smart Remote.

### Milestone 14 - Favorites and Library Views - complete; physical-TV acceptance passed 26 October 2026

Add first-class Favorites browsing and evaluate other simple, useful Immich-backed library views that can reuse the generic asset collection infrastructure, such as:

- Favorites
- Videos
- Recently added

Favorites should also be available as a Home rail where appropriate. The application remains read-only; favoriting/unfavoriting is not required merely because Favorites can be viewed.

Carry-over (16 October 2026): Recently Added paging. **Resolved in Milestone 14:** structured search cannot order by upload date, so Recently Added stays on timeline buckets; page tokens now name the month by `timeBucket` and carry the months fetched on the first page.

- `getRecentlyAddedBucketPage` pages by a bucket's position in a month list that is re-fetched for every page. A new upload that creates a new month between page loads shifts the positions, and can duplicate or skip a month. Each page also costs two requests.
- When Recently added becomes a library view, key the page token on the bucket's `timeBucket` value rather than its index, and reuse the fetched bucket list within a collection session.

#### Implemented behaviour

- Library views are reached from Home rails and their See more tiles; no left-rail destination was added. Home has a Videos rail directly after Favourites.
- Favourites, Videos and Recently added open the shared collection on a typed library route with those headers. A rail item opens the view on that item, and Back returns to it; See more opens the view on its first item, and Back returns to See more.
- Videos lists timeline videos newest first; Live Photo motion clips are hidden assets in Immich and never appear. Slideshow over Videos follows the existing rules: videos do not autoplay during a slideshow, so each shows its poster for the interval.
- Viewing history records a `library` source. No counts are shown, so no extra API-key permission is needed.

Success criterion: important common library subsets can be browsed without duplicating collection, viewer, or slideshow logic.

### Milestone 15 - Personalisation and Navigation - complete; physical-TV acceptance passed 26 October 2026

**Status:** complete on `main` (ADR 0017); physical-TV acceptance passed 26 October 2026.

Four features chosen from TV use, each reusing the existing shared collection, viewer and Settings patterns. There are no on-screen hints for the date-rail acceleration or the channel keys (user decision).

#### Date-rail navigation (Photos)

- **Hold to accelerate.** While Up or Down is held on the Photos date rail, each repeat moves one month bucket for the first second, then to the next year marker (the year boundaries the rail already labels), and after three seconds two years at a time. The thresholds are named constants. A hold is detected from `KeyboardEvent.repeat` or, where the runtime doesn't set it, the same key arriving within 250 ms. It resets on key release, another key, a change of direction, a longer gap, leaving the rail, hiding the screen or a lifecycle pause. The first press of a hold is always one month, so single presses stay precise.
- **At most one re-render per frame.** Key handling only moves the selection; the rail re-renders and refocuses at most once per animation frame. Holding loads nothing: photos still load only when OK jumps to the selected month.
- **CH ▲ / CH ▼ jump a year.** The channel rocker (registered through the platform layer) moves the date-rail selection to the previous or next year marker. From the Photos grid it enters the rail at the focused photo's month first. It does nothing on other screens. PageUp and PageDown do the same on the desktop preview (ADR 0015 precedent). Up, Down, Left, Right, OK and Back remain the only required keys.
- **Order-aware.** Up/Down and CH always mean towards the top or bottom of the rail as displayed, in either sort order.

#### Home rails in Settings

- A **Home** section in Settings turns each Home rail on or off, listed in Home order with their Home titles. All are on by default; saving follows the existing Settings save behaviour. The settings store gains a schema version and migration.
- Rails that are off are not rendered, fetched, given thumbnail requests or reachable by navigation, and the startup splash waits only for enabled rails. Changes apply the next time Home is shown. If every rail is off, Home shows "Choose what Home shows in Settings." with an **Open Settings** button.
- Turning Recently Viewed off only hides the rail; viewing history is still recorded. Reordering rails and clearing history are possible later work.

#### Collection sort order

- A header button reading **Newest first** or **Oldest first** reverses Photos, albums, people, Favourites, Videos and Search results, reloading from the start with focus kept on the button. Memories, Recently Viewed and Recently Added keep their own order and show no control.
- The choice is saved per collection kind (Photos, Favourites, Videos, people, Search), defaulting to newest first. Albums start in the album's own Immich order and can be reversed for the session only. Opening a library view or person from a specific Home rail item opens it newest first for that visit, so the chosen item can be focused.
- Photos oldest first reverses the date rail, date headings, year markers and jumps; the viewer and slideshow follow the collection order.

#### Face tags in the viewer

- A **Faces** button in the viewer's controls (images and Live Photo stills only; saved, default off) outlines the faces Immich has tagged on the current photo, with readable names for named people. Unnamed faces get an outline only; hidden people are never shown.
- Faces are fetched only while the toggle is on, for the displayed photo only, with a tiny bounded cache. They're hidden during a slideshow. Without the `face.read` API-key permission, a single calm message explains what's needed and Faces turns off for the session.

Success criterion: everyday browsing is faster and more personal on the TV, without new frameworks, extra backend services or unbounded resource use.

### Milestone 16 - Search v2 - complete; physical-TV acceptance passed 26 October 2026

Extend Search v1 (ADR 0014) with three remote-friendly criteria. Each new criterion is one criteria field plus its helpers, one mapper line and one panel row; no query builder.

- **Media type:** an Asset type drop-down beside the dates, choosing All, Photos, Live Photos or Videos. "Photos" means all still images, including Live Photos (`type` IMAGE). "Live Photos" means `type` IMAGE with `isMotion: { eq: true }` (Immich matches assets whose `livePhotoVideoId` is set). "Videos" means `type` VIDEO.
- **Location:** one place, chosen by drilling down from a country to an optional region and then an optional city, using values from `GET /search/suggestions?type=country|state|city` (asset read). Nothing is typed. The filter uses `country`, `state` and `city`.
- **Albums:** a multi-select picker reusing the people-picker pattern. It matches photos in *any* chosen album (`albumIds.any`), and the panel says so in plain words.

**Status:** complete on `main` (PR #4, [ADR 0018](architecture/0018-search-v2.md)); physical Q950R acceptance passed on 26 October 2026 (user confirmation).

**Permissions.** Media type and location need only asset read. The album filter also needs album read on each chosen album (`resolveSearchScopeV3` checks `Permission.AlbumRead`), which the app already uses for Albums, so there is no new permission.

**Scope.** Search covers your own photos and those of partners whose "Show in timeline" is on, and location suggestions come from the same set (`getUserIdsToSearch`). A search that includes albums searches those albums' whole contents instead, including photos other members added to a shared album (`isFullyAlbumConfined`).

**Decisions (October 2026).**

- One place at a time. A city can be chosen within a country with no regions, as the suggestions API filters cities by country alone.
- Albums match *any* chosen album, deliberately unlike People's *all*; at most 10, like People.
- All criteria combine as AND.
- Picking a place and picking albums are child screens of Search (`search-place`, `search-albums`), each returning focus to its row.
- Live Photos sit inside Photos: Photos means every still image, Live Photos only those with motion.
- Search v2 also removes partners' favourites from Favourites, to match Immich Web (ADR 0016 update).

Verify the API again at implementation time.

### Milestone 17 - Shared Content - parked

**Status:** parked by the user's decision on 26 October 2026: deferred, not cancelled. Nothing below is implemented yet.

Add appropriate support for Immich content shared with the current user.

At implementation time, verify the current Immich API model for albums owned by the current user, albums shared with the user, and shared/partner library concepts exposed by the current API. Do not make assumptions based on old Immich behaviour.

Shared content should integrate naturally with the existing Albums/Home/asset browsing experiences rather than becoming a separate application architecture.

Success criterion: content legitimately available to the logged-in Immich user can be discovered and viewed consistently regardless of ownership.

### Milestone 18 - Ambient / Screensaver Mode - complete; physical-TV acceptance passed 27 October 2026

Build an ambient photo-frame/screensaver-style experience on top of the existing slideshow/viewer infrastructure.

Potential sources should include selected album, Favorites, recent photos, all photos, and Memories where appropriate. Initial options may include interval, sequential or shuffle order, images-only or images-plus-video behaviour, metadata overlay, sensible avoidance of immediate repetition, and transition behaviour appropriate to Tizen performance.

Do not create a separate image loading/playback engine. Ambient mode must continue to respect bounded media/resource usage during long-running sessions.

Investigate Samsung/Tizen lifecycle and screensaver restrictions before deciding whether this can act as a true platform screensaver or should instead be an in-app ambient mode.

Success criterion: the television can reliably display Immich content for an extended period without memory growth, crashes, or repeated manual intervention.

**Status:** complete on `main` (PR #5, [ADR 0019](architecture/0019-ambient-mode.md)); physical Q950R acceptance passed on 27 October 2026 (user confirmation), including the overnight soak test and the idle-timer fix. The investigation found no public route for a third-party app to be the TV's screensaver or Ambient Mode app, so ambient mode is in-app.

#### Concrete scope (26 October 2026)

- **The TV's own screensaver.** Slideshows, video and Live Photo playback, and ambient mode tell the TV that passive viewing is under way through `webapis.appcommon.setScreenSaver`, behind a reference-counted platform module (`src/platform/tizen/screensaver.ts`). Samsung requires this of store apps, and the app didn't do it before. Investigate first whether a third-party app can be the TV's real screensaver or Ambient Mode app; the expected outcome is an in-app ambient mode plus correct control of the TV screensaver.
- **Viewer split first.** `asset-viewer.ts` (972 lines) is split so ambient mode reuses the viewer's single-asset media handling instead of copying it. No separate image loading or playback engine.
- **Sources:**
  - **All photos** (default): `POST /search/random` in small batches.
  - **Favourites**, your own only: sampled from the timeline buckets Favourites already uses (`isFavorite=true`, no partners), weighting buckets by count and loading one bucket at a time.
  - **Recent**: taken in the last 90 days.
  - **An album**: chosen with a single-select album picker; shuffled or in order.
  - **Memories**: in Memory order or shuffled.
- **Order:** Shuffle by default; In order for Album and Memories. A bounded ring of recent ids prevents immediate repeats; small sources wrap around.
- **Media:** photos only by default; videos optionally, capped at 60 seconds and muted unless Play video sound is on. Live Photos show their still.
- **Presentation:** a full-screen `ambient` route over everything, crossfading with opacity only between two layers, with at most three decoded images. Interval 10 s to 5 min (30 s default). Optional quiet overlays (a clock, on by default; photo details) that move around the safe area every few minutes against burn-in. Contain, on a dark background.
- **Starting and stopping:**
  - Start now from Settings → Ambient.
  - Start after idle (off by default; 5 to 30 minutes), only on browsing screens.
  - Any key exits and returns exactly where you were, and that press does nothing else.
  - Stop after (never by default; 1 to 4 hours) ends ambient mode and lets the TV's screensaver take over.
  - Hiding the app pauses ambient mode.
- **Long runs:** failed assets are skipped (bounded); an unreachable server shows a calm message and retries with capped backoff; no unbounded arrays, listeners, timers or object URLs.
- **Settings → Ambient:** source, album, order, interval, include videos, play video sound, show clock, show photo details, start after idle, stop after, and Start now, persisted in `AppSettings` with a schema bump.
- No new Home rail and no new left-rail destination.

#### OLED screensaver note (3 November 2026)

[Issue #15](https://github.com/rfsmason/immich-tv-for-samsung/issues/15): on a Samsung OLED TV (S90F), the TV's burn-in Screen Saver interrupts slideshows and ambient mode after about two minutes, although the app holds the screensaver off through AppCommon. Samsung says that Screen Saver can't be disabled and may not start during full-screen video. An opt-in Settings → Display → "Keep OLED screensaver away" plays a hidden black clip while photos show, slideshows then show videos as stills, and ambient mode leaves them out, with its Include videos turned off and locked ([ADR 0023](architecture/0023-oled-keep-awake.md)). It is unverified on an OLED TV until the reporter tests it.

#### Store distribution note (1 November 2026)

Builds are `sideload` (the default) or `store`, chosen with `--store` or `IMMICH_TV_DISTRIBUTION=store` ([ADR 0021](architecture/0021-support-us.md)). A store build contains no Ko-fi link, QR code, Support Us section or splash support line, and the check fails if one does. Any future store tipping goes through Samsung Checkout. Packaging and deployment defaults stay sideload.

### Milestone 18.5 - Viewing and Accessibility Polish - complete; physical-TV acceptance passed

Four improvements to viewing and accessibility, chosen by the user, which take priority over Milestones 17 (parked), 19 and 20 (user decision, 28 October 2026):

- **High contrast.** A Settings → Display → High contrast option: white text on solid dark surfaces, no background picture, a visible edge on every control, a two-colour focus ring that shows on any background including photos, and solid backing behind text over photos. Colours move onto named tokens first, so the theme only overrides tokens. It applies before the splash's first paint. The light-blue default look stays the default.
- **When the playback buttons fade.** Settings → Display → Hide playback buttons: 3, 5 (default), 10 or 15 seconds, or Never (WCAG 2.2.1).
- **Slideshows play videos in full** when "Autoplay videos" is on: a video plays to its end with sound, then the slideshow moves on. Photos keep the interval and Live Photos stay stills. A video that fails or stalls is skipped. With autoplay off, nothing changes.
- **Skipping through a video.** The progress bar becomes a focusable slider: Left/Right skip 10 s, speeding up to 30 s and 60 s steps when held, and the seek is committed when the keys stop. Rewind and fast-forward keys skip while a video shows. Left/Right on the picture keep moving between items.

Constraints: ADR 0012's patterns (Samsung APIs under `src/platform/tizen/`, Settings sections under `src/screens/settings/`, schema bumps with migration tests, no second media engine); seeking in its own module, with `asset-viewer.ts` kept under about 920 lines; no new framework or dependency.

Success criterion: on the physical Q950R, high contrast is readable and its focus unmistakable from the sofa, the buttons fade when chosen, a slideshow plays its videos through, and a video can be skipped through with the remote.

**Status:** complete on `main` (PR #6, [ADR 0020](architecture/0020-viewing-and-accessibility.md)); physical Q950R acceptance passed (user confirmation, 30 October 2026).

### Milestone 19 - Consumer-Friendly Pairing and Authentication

Replace or supplement manual API-key entry with an authentication experience suitable for ordinary TV users.

Desired UX is conceptually:

```text
TV displays short code and/or QR code
-> user opens a phone/browser
-> user authenticates with Immich
-> TV receives authorised credentials
-> TV stores those credentials appropriately
```

Do not introduce an additional backend service unless investigation proves it is genuinely necessary.

In the meantime, installs from Apps2Samsung's community catalogue can carry the server URL and API key, entered in Apps2Samsung's form on the computer and saved on the app's first start ([ADR 0022](architecture/0022-install-preset.md)).

At this milestone revisit credential persistence, least-privilege permissions, logout/disconnect, server switching, API-key/query-string authentication currently required for HTML video playback, and whether current Immich authentication APIs provide a suitable pairing/device-authorisation mechanism.

#### Authentication approach order

When Milestone 19 is implemented, investigate authentication options in this order:

1. Prefer a native Immich-supported device-authorisation or pairing flow if Immich provides one by then.
2. If not available, investigate a reliable local/LAN pairing mechanism between phone/browser and TV that avoids any external service.
3. If neither provides a suitable TV experience, implement a minimal pairing broker.

Do not introduce a cloud service if Immich itself or a local pairing mechanism can solve the problem cleanly.

#### Pairing broker fallback

If a broker is required, design it as a minimal temporary rendezvous service rather than as a permanent identity provider.

The intended model is:

```text
Phone/browser
    |
    | temporary pairing exchange
    v
Pairing broker
    ^
    |
Samsung TV
```

After pairing completes, normal application traffic must return to:

```text
Samsung TV -> user's Immich server directly
```

The broker must never become a proxy for normal Immich API traffic.

#### Hosted and self-hosted broker

If a broker is implemented:

- Provide a hosted public instance as the default convenience option.
- Make the same broker software freely available for self-hosting.
- Provide an official container image suitable for a simple Docker deployment.
- Allow the TV app to use a custom broker URL instead of the hosted default.
- Keep the hosted and self-hosted implementations protocol-compatible.
- Do not require users to create a separate Immich TV account merely to pair a device.

This is intentional because many Immich users already self-host infrastructure and may prefer not to use a third-party pairing service.

The product should therefore support both:

```text
Default pairing service:
https://pair.example.com

Custom/self-hosted pairing service:
https://pair.my-domain.example
```

The exact domain is not to be decided yet.

#### Broker security model

Prefer an end-to-end encrypted rendezvous design in which the broker cannot read the Immich credential being exchanged.

A preferred conceptual flow is:

1. TV creates a short-lived pairing session and ephemeral cryptographic key material.
2. TV displays a QR code and/or short pairing code.
3. User opens the pairing URL on a phone/browser.
4. The phone/browser authenticates against the user's Immich server or obtains the required Immich credential.
5. The credential is encrypted for the TV before being submitted to the broker.
6. The broker temporarily stores or relays only the encrypted payload.
7. The TV retrieves the payload and decrypts it locally.
8. The pairing session is immediately destroyed or allowed to expire after a short TTL.
9. Subsequent TV communication goes directly to Immich.

The exact cryptographic protocol must be designed and reviewed at implementation time rather than improvised in the project brief.

#### Hard architectural requirements

If the broker architecture is implemented:

- No photos, videos, thumbnails, metadata, or normal Immich API traffic may pass through the broker.
- The broker must not act as an ongoing user identity provider.
- No permanent user account with the broker should be required.
- Plaintext Immich credentials must not be stored by the broker.
- Pairing sessions must be short-lived.
- Pairing records must expire automatically.
- Pairing identifiers must have sufficient entropy and must not rely solely on a short human-readable code for security.
- Rate limiting and abuse protection must be implemented.
- Broker logs must not contain credentials or decrypted authentication material.
- The broker URL must be configurable in the TV app.
- Self-hosted and hosted brokers must use the same documented protocol.
- Already-paired TVs must continue to function if the broker later becomes unavailable.
- Pairing failure must never invalidate an existing working Immich connection.
- Normal application operation must remain independent of the broker after pairing.

#### Open-source boundary

If the main Samsung TV client remains proprietary, the broker may still be released separately as freely available/open-source infrastructure.

The intended product boundary may therefore be:

- Samsung TV application: proprietary.
- Pairing protocol: documented.
- Pairing broker: freely available/open source.
- Docker image: freely available.
- Hosted broker: optional free convenience service.

Do not make this source-licensing decision irreversible in the brief, but record it as the preferred direction if a broker becomes necessary.

Success criterion: a normal Immich user can securely pair the Samsung TV client without manually entering a long API key using the remote, while preserving direct TV-to-Immich operation after pairing and allowing privacy-conscious users to self-host the pairing service if a broker architecture is required.

### Milestone 20 - Product Hardening and Samsung Release Readiness

Once the feature set and navigation model are stable, harden the application for long-term use and possible wider distribution.

Include startup/reconnect resilience, graceful handling of Immich server/API compatibility problems, network interruption behaviour, suspend/resume and application lifecycle handling, long-running memory/resource testing, slow-network behaviour, settings schema migration/versioning, readability and accessibility review, testing on newer Samsung/Tizen versions where practical, icon/splash/application artwork, production logging/error behaviour, privacy/support documentation, release packaging, and Samsung TV application/store requirements if distribution is pursued.

The physical QE55Q950R remains the minimum authoritative integration target, while this milestone should begin validating that the application behaves sensibly on newer supported Samsung TVs.

Carry-over notes from the Milestone 11.5 review (16 October 2026):

- **Stalled connections.** Chromium 63 cannot abort a `fetch`, so timed-out requests keep occupying the browser's connections to the server (about six per host) until the server or TCP closes them. Recovery after a stall can therefore lag, and queued requests' timeouts include time spent waiting for a connection. Cover this in network-interruption and slow-network testing, and consider backing off thumbnail concurrency after repeated timeouts.
- **CSS compatibility check.** The check is rule-level. It decides flex versus grid only from rules with the same selector, so a `gap` on an element made flex by a different rule could pass with an ineffective `grid-gap` fallback. Strengthen it if layout CSS grows.
- **Playback on hide.** The app pauses playback when hidden. Samsung's Multitasking guide suggests treating hide during playback like Return. Confirm the pause behaviour is acceptable for store review.
- **CI status.** The Cloudflare "Workers Builds" check fails on every PR. Fix or disconnect that integration so release PRs show fully green.

Carry-over notes from the Milestone 14 review (21 October 2026):

- **Home thumbnail concurrency. Resolved on 22 October 2026:** Home now loads rail data in screen order and shares one six-request thumbnail queue across every rail, nearest the focused rail first (ADR 0016, "Resource bounds and Home concurrency").

Success criterion: the project is no longer merely a successful development application; it is technically and operationally suitable for sustained everyday use and, if desired, preparation for public distribution.

## Cross-Roadmap Principles

- Asset collections should converge on reusable domain/service/grid/windowing infrastructure.
- Viewer behaviour should remain shared across Albums, Photos, Home, Memories, People, Search, Favorites, and shared content.
- Slideshow should operate over generic ordered asset collections rather than being album-specific.
- Video and Live Photo handling should remain shared.
- Home is an aggregator of capabilities, not a second implementation of them.
- Immich remains responsible for facial recognition, Memories generation, search indexing, transcoding, and library/storage management.
- The client remains read-only unless a future explicit product decision changes that boundary.
- Resource usage must remain bounded independently of library size.
- Every feature must remain fully usable with the Samsung Smart Remote.
- New Immich API usage must be verified against the current documented API before implementation.
- Any future cloud component must be optional unless there is a compelling technical reason otherwise.
- The application should continue to operate directly against the user's Immich server.
- Hosted convenience services should not become mandatory dependencies for normal viewing.
- Where a small supporting service is useful, prefer designs that can also be self-hosted by technically capable users.
- Significant architectural decisions introduced by roadmap milestones should get an ADR under `docs/architecture/`.

## UI Direction

Immich now provides `@immich/ui`, a Svelte component library and design system for Immich-branded applications. The TV app should remain compatible with that direction without prematurely adopting the runtime package.

When making UI decisions:

- Prefer Immich-aligned visual language for colours, spacing, loading states, icons, typography, and control tone where it fits a TV interface.
- Keep presentation styling in CSS and keep remote-control focus/navigation logic separate from visual treatment so components can be revisited later.
- Do not introduce `@immich/ui`, Svelte, Tailwind, or another UI framework without a compatibility spike that proves build output, bundle size, and runtime behaviour on Tizen 5.0 / Chromium M63.
- TV-first usability wins over matching Immich Web or Immich UI components exactly. Components that assume mouse, hover, dense desktop layouts, or ordinary keyboard navigation should be adapted rather than copied.
- Avoid creating a large bespoke design system that would make later adoption of Immich UI harder. Use small, local patterns until repeated UI needs justify a shared abstraction.

## Future Considerations

- Additional search filters such as location, media type, album, Favorites, or Immich smart/free-text search if suitable current APIs exist.
- Richer slideshow transitions and display options, provided they remain performant on Tizen 5.0.
- Optional writable operations such as Favorite/unfavorite only if the read-only product boundary is intentionally reconsidered.
- Wider platform/device support beyond Samsung Tizen after the Samsung TV product is stable.
- An animated version of the Immich TV logo for the splash screen, built from the existing artwork, provided it stays smooth and light on Tizen 5.0.
