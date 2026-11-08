# Immich TV for Samsung

Immich TV for Samsung is an unofficial, TV-first, read-only Samsung Tizen Web Application for browsing an Immich photo library.

**Want to try it on your TV?** See the [beta install guide](docs/beta-testing.md). The rest of this README is for developers.

The app installs as a native Tizen Web Application on the Samsung QE55Q950R. It connects directly to an Immich server and offers Home, Photos, Albums, People and Memories browsing, Search by people, dates, type, place and albums, a full-screen viewer with video and Live Photo playback, a slideshow, and Settings, all operable with the Samsung Smart Remote.

## Current Status

- Target device: Samsung QE55Q950RBTXXU, 2019, Tizen 5.0 / Chromium M63. Application ID `imchTV0001.ImmichTV`.
- Milestones 1-16, 18 and 18.5 are complete on `main`, and physical-TV acceptance of Milestones 12-16 passed on 26 October 2026 (Milestone 18 on 27 October 2026, Milestone 18.5 confirmed on 30 October 2026). They include:
  - Home: bounded rails (Recently Added, Favourites, Videos, People, Recently Viewed, Albums and Memories).
  - Photos: the main timeline, with date sections and a timeline rail.
  - Albums: an album grid and album detail.
  - Memories: today's Memories.
  - Viewer: images, video and Live Photos, slideshow, and a local viewing history.
  - Settings: connection, display and Home preferences, with an unsaved-changes guard.
- Milestone 11.5, Foundation Hardening and Structural Refactor, passed physical-TV acceptance on 16 October 2026. It covers:
  - Chromium 63 fixes, with compatibility enforced by lint and static checks;
  - request timeouts and permission-specific errors;
  - Tizen lifecycle handling and an exit confirmation on Back at the application root;
  - decomposition of the shared collection screen and Home;
  - a screen registry for routing;
  - a minified bundle, an enforced formatter, and coverage thresholds.
- Milestone 12, People: Home's People rail ends with See more, which opens a paged grid of every recognised person. Choosing a person opens their photos and videos in the shared grid, viewer and slideshow. See [ADR 0013](docs/architecture/0013-people.md) and [docs/project-brief.md](docs/project-brief.md).
- Milestone 13, Search v1: Search finds photos by one or more people, a From and To date, or both, with remote-only controls: a people picker, chips and an inline date stepper. Results open in the shared grid, viewer and slideshow. See [ADR 0014](docs/architecture/0014-search.md).
- Milestone 14, Favorites and Library Views: Favourites, a new Videos rail and Recently added open as library views from Home, using the shared grid, viewer and slideshow. See [ADR 0016](docs/architecture/0016-library-views.md).
- Milestone 15, Personalisation and Navigation: held Up/Down on the Photos date rail speed up from months to years, CH ▲/▼ jump a year, Settings can turn each Home rail on or off, collections can be reversed between newest and oldest first, the viewer can show face tags, and every screen sits on one standard background. See [ADR 0017](docs/architecture/0017-personalisation-and-navigation.md).
- Milestone 16, Search v2: Search also finds photos by type (Photos, Live Photos or Videos), one place chosen from country down to city, and any of up to ten albums, each picked with the remote. See [ADR 0018](docs/architecture/0018-search-v2.md).
- Milestone 17, Shared Content, is parked (deferred, not cancelled).
- Milestone 18, Ambient / Screensaver Mode, is complete on `main`: slideshows and playback now keep the TV's own screensaver away, as Samsung requires, and Settings → Ambient starts a full-screen photo mode (All photos, your own Favourites, Recent, an album or Memories) now, or after an idle time. Any key returns to where you were. Physical-TV acceptance passed on 27 October 2026. See [ADR 0019](docs/architecture/0019-ambient-mode.md).
- Milestone 18.5, Viewing and Accessibility Polish, is complete on `main`: a high-contrast option, a choice of when the playback buttons fade, slideshows that play videos in full when Autoplay videos is on, and skipping through a video from its progress bar or with rewind and fast forward. It took priority over Milestones 17, 19 and 20. Physical-TV acceptance passed (user confirmation, 30 October 2026). See [ADR 0020](docs/architecture/0020-viewing-and-accessibility.md).
- Requires Immich v3.2.0 or later (see [Immich Configuration](#immich-configuration)).

## Beta Testing

Beta builds are published as unsigned `.wgt` packages on [GitHub Releases](https://github.com/rfsmason/immich-tv-for-samsung/releases), marked as pre-releases. Testers sign and install them for their own TV with Apps2Samsung, whose [community catalogue](https://github.com/Apps2Samsung/tizen-community-packages) lists Immich TV, or Tizen Studio: see [docs/beta-testing.md](docs/beta-testing.md). `npm run tizen:package:unsigned` builds the package; the release steps are in the [deploy runbook](docs/tizen-deploy-runbook.md#beta-release-package).

## Accessibility

- **Support Us** (Settings → Support Us, sideload builds only) shows a QR code and the short address of the project's Ko-fi tip page, with suggested tips. Tips are optional and unlock nothing; the TV never pays or contacts Ko-fi. An honour-based "I've already supported Immich TV" toggle turns the splash's line into a thank-you. See [ADR 0021](docs/architecture/0021-support-us.md).
- **High contrast** (Settings → Display) shows white text on solid black, hides the background picture, gives every control a visible edge, and uses a white-and-black focus ring that shows on any background, including photos. Text over photos sits on a solid plate. The light-blue look stays the default. `npm run lint` measures both themes' colour contrast (ADR 0020).
- **Keep OLED screensaver away** (Settings → Display, off by default) is for Samsung OLED TVs, whose burn-in screensaver can interrupt slideshows and ambient mode after about two minutes. It plays a hidden black video while photos show, slideshows then show videos as stills, and ambient mode leaves them out (its Include videos is turned off and locked). Not yet confirmed on an OLED TV; see [ADR 0023](docs/architecture/0023-oled-keep-awake.md).
- **Hide playback buttons** (Settings → Display) chooses when the viewer's buttons fade during a slideshow or video: 3, 5, 10 or 15 seconds, or Never.
- Everything works with the arrows, OK and Back; Play/Pause, rewind, fast forward and the channel keys are shortcuts.

## Project Layout

```text
config.xml                  Tizen web application manifest copied into dist/
index.html                  App markup copied into dist/
styles/main.css             TV-first styling copied into dist/
src/app/                    Composition (main.ts, application.ts), shell, screen registry, services
src/api/immich/             Immich REST client, HTTP transport (timeouts, status mapping),
                            response DTOs, validators, mappers and the minimum version
src/domain/                 Application domain types
src/presentation/           Household-facing date, duration, Memory, person and Search labels
src/screens/                Screens, the shared card grid, grid presentation and media elements
src/screens/ambient/        Ambient mode: crossfading player, overlays and bounded timers
src/screens/collection/     Shared collection grid, Photos timeline, viewer and playback
src/screens/home/           Home rails: model, loaders, rendering, navigation, thumbnails
src/screens/people/         People grid and person card shared by the People browser and Search
src/screens/albums/         Album tile shared by Albums and the Search album picker
src/screens/search/         Search criteria panel and rows, date stepper, and people, place and album pickers
src/platform/tizen/         Remote keys, lifecycle and exit, Tizen runtime typings
src/storage/                localStorage-backed settings and viewing history
src/navigation/             Grid and focus navigation helpers
src/errors/, src/logging/   Typed application errors and redacting logger
src/test/                   Test-only helpers and fakes
scripts/                    Build, static and compatibility checks, packaging, deploy, preview
docs/                       Project brief, toolchain, deploy runbook and ADRs
dist/                       Generated runtime files, not committed
website/                    Public landing website (static, separate from the TV app)
```

## Local Checks

```sh
npm ci
npm run typecheck
npm run format:check
npm run lint
npm test
npm run test:coverage
npm run build
npm run check
npm run stage:tizen
```

- `npm run lint` runs ESLint (including `eslint-plugin-compat` for the `chrome 63` browserslist target), the project's CSS and DOM-member Chromium 63 compatibility checks, and the theme contrast check (`scripts/check-contrast.mjs`).
- `npm run format` applies Prettier and ESLint fixes; `npm run format:check` verifies formatting.
- `npm run test:coverage` runs the tests with V8 coverage and enforced minimums for `src/screens` and `src/app`.
- `npm run build` bundles `src/app/main.ts` for Tizen 5.0 / Chromium M63 into a minified `dist/`. `npm run build:debug` produces an unminified bundle for on-TV diagnosis. Builds are sideload builds, with Settings › Support Us, unless `npm run build:store` (or `IMMICH_TV_DISTRIBUTION=store` with any build, package or deploy command) asks for a store build, which contains no tip link at all; `IMMICH_TV_DISTRIBUTION=store npm run check` confirms it (ADR 0021).
- `npm run check` verifies the runtime files and manifest, that no source, tooling or source maps reach `dist/`, that the built bundle uses no Chrome 64+ DOM members, and (offline) that the website's demo video tiles match `website/demo-videos.json` (see [website/README.md](website/README.md#demo-videos)).
- `npm run stage:tizen` builds and stages exactly the runtime files that are packaged into the widget.

CI runs all of these on every pull request.

## Desktop Preview

Use the local preview server for browser smoke tests:

```sh
npm run preview
```

Then open the printed `http://127.0.0.1:<port>/` URL in Chrome or Safari. This avoids local file-preview differences and serves CSS/JavaScript with explicit MIME types and no caching.

The preview script is copied into `dist/` for local testing and injected by the preview server only. It is not linked from `index.html` and is not staged into the signed Tizen widget.

For local browser testing, the preview server also provides a same-origin proxy for Immich API and thumbnail requests. This avoids browser-only CORS failures during local Chrome/Safari testing; the packaged Tizen app still calls Immich directly using the network access declared in `config.xml`.

Scripted website screenshots and video walkthroughs: [docs/capture.md](docs/capture.md) (demo library only).

## Tizen Build Path

After installing Tizen Studio with the Web CLI and Samsung TV Extension packages, copy `.env.tizen.example` to `.env.tizen` and fill in your TV's SDB address, its target name and your certificate profile. The file is ignored by git, and the same settings can be set in the environment instead. Then:

```sh
npm run tizen:package
```

This first builds `dist/`, then stages only the production runtime app files under `.tizen/package-src`, copies them into `.buildResult` (no `tizen build-web` step, so a Web CLI-only Tizen Studio install is enough), signs the widget, and writes `.tizen/package-src/.buildResult/ImmichTV.wgt`.

Then install and run the generated package on the TV using the connected target name from:

```sh
npm run tizen:devices
```

More detailed setup notes are in [docs/toolchain.md](docs/toolchain.md).

## Immich Configuration

The app requires **Immich v3.2.0 or later**. Album detail, Favourites and People use Immich's structured metadata search (`filter`, `orderBy` and `cursor`), which v3.2.0 introduced. `Test connection` warns when the server is older, but still lets you save the settings.

The TV app stores the Immich server URL and API key in browser `localStorage` on the device. Use the on-screen setup form to enter them and test connectivity. `Test connection` validates and checks the settings without saving them; `Save` persists them explicitly. When saved settings exist, the app opens on Home; use **Settings** in the navigation rail to change the connection later.

Apps2Samsung's community catalogue can fill them in instead: its install form writes the server URL and API key into `scripts/install-preset.js` in the user's own package, and the app saves them on its first start ([ADR 0022](docs/architecture/0022-install-preset.md)). Release packages carry empty values.

This is an intentional lightweight credential choice for the local TV app. The API key is not stored in source, not baked into release packages, not sent anywhere except the configured Immich server, and not logged by the app. Anyone with access to the TV runtime storage could potentially recover it, so use an Immich API key with only the access you are comfortable granting to the TV.

`.env.example` remains only a development reference. Do not commit real API keys or private server details.

### Required API key permissions

The app only reads from Immich. An API key needs these permissions, taken from the `@Authenticated` decorators of the Immich endpoints the app calls (Immich `main` at `1cf5bb4`; `GET /search/suggestions` checked at `c6d1e15`):

| Permission | Used for | Endpoints |
| --- | --- | --- |
| `asset.read` | Photos timeline, Recently Added, album, Favourites, Videos, People and Search grids, Search places, Recently Viewed, and ambient mode | `GET /timeline/buckets`, `GET /timeline/bucket`, `POST /search/metadata`, `POST /search/random`, `GET /search/suggestions`, `GET /assets/{id}` |
| `asset.view` | Thumbnails, viewer previews and video playback | `GET /assets/{id}/thumbnail`, `GET /assets/{id}/video/playback` |
| `album.read` | Albums, and the Search album picker and filter | `GET /albums`, `GET /albums/{id}` |
| `person.read` | People and the Search people picker | `GET /people`, `GET /people/{id}/thumbnail` |
| `memory.read` | Memories | `GET /memories` |
| `memory.statistics` | The Memories rail's View all | `GET /memories/statistics` |
| `face.read` | The viewer's Faces button (optional) | `GET /faces?id={assetId}` |
| `user.read` | `Test connection` | `GET /users/me` |

`GET /server/version` needs no permission. A key without one of these permissions still works: the screen that needs it explains which feature the key cannot show, and without `face.read` the viewer turns Faces off for the session.

## Contributing, Security and Licence

- [CONTRIBUTING.md](CONTRIBUTING.md): setup, the checks to run, and the project's rules.
- [SECURITY.md](SECURITY.md): how to report a security problem privately.
- Licensed under the [MIT Licence](LICENSE).

Immich TV for Samsung is an independent, unofficial client. It is not affiliated with or endorsed by Immich, FUTO or Samsung.
