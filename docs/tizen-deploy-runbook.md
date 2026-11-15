# Tizen Deploy Runbook

Use this runbook when deploying to the physical Samsung Q950R.

## Known-Good Command

First, give the scripts your own TV and signing settings. Copy `.env.tizen.example` to `.env.tizen` (ignored by git) and fill in:

- `TIZEN_TV_HOST`: the TV's SDB address, `<tv-ip>:26101`;
- `TIZEN_TARGET_NAME`: the target name `sdb devices` shows for the TV. On the Q950R test TV it's the model code, `QE55Q950RBTXXU`;
- `TIZEN_CERT_PROFILE`: your Tizen Studio certificate profile.

The same names can be set in the environment instead. The app ID defaults to `imchTV0001.ImmichTV` (from `config.xml`), and `TIZEN_APP_ID` overrides it.

Then, from the project root:

```sh
npm run tizen:deploy
```

## Important Target Detail

`sdb devices` shows the raw SDB serial next to the target name:

```text
<tv-ip>:26101    device    <target-name>
```

Use the target name, not the raw `<tv-ip>:26101` value, for Tizen CLI commands such as `install-permit`, `install` and `run`. With the raw value, Tizen CLI can fail with:

```text
There is no <tv-ip>:26101 target.
```

## Stale SDB Recovery

The commands below use the values from `.env.tizen`. Load them into your shell first:

```sh
set -a; . ./.env.tizen; set +a
```

If deployment hangs with no output, or if `sdb devices` works but `sdb shell`, `tizen install` or `tizen install-permit` hangs, restart SDB and reconnect:

```sh
$HOME/tizen-studio/tools/sdb kill-server
$HOME/tizen-studio/tools/sdb start-server
$HOME/tizen-studio/tools/sdb connect "$TIZEN_TV_HOST"
$HOME/tizen-studio/tools/sdb devices
```

If needed, check for stale agents:

```sh
ps -ef | egrep 'sdb|tizen' | grep -v egrep
```

After reconnecting, refresh install permission with the target name:

```sh
$HOME/tizen-studio/tools/ide/bin/tizen install-permit -t "$TIZEN_TARGET_NAME"
```

## Manual Deploy Sequence

If the script is not available, use the same sequence manually, with `.env.tizen` loaded as above:

```sh
$HOME/tizen-studio/tools/sdb kill-server
$HOME/tizen-studio/tools/sdb start-server
$HOME/tizen-studio/tools/sdb connect "$TIZEN_TV_HOST"
$HOME/tizen-studio/tools/ide/bin/tizen install-permit -t "$TIZEN_TARGET_NAME"
TIZEN_CLI=$HOME/tizen-studio/tools/ide/bin/tizen npm run tizen:package
cd .tizen/package-src/.buildResult
$HOME/tizen-studio/tools/ide/bin/tizen install -t "$TIZEN_TARGET_NAME" --name ImmichTV.wgt -- .
$HOME/tizen-studio/tools/ide/bin/tizen run -t "$TIZEN_TARGET_NAME" -p imchTV0001.ImmichTV
```

## Debug Build For On-TV Diagnosis

Production builds ship a minified `scripts/main.js`. To inspect readable code and stack traces in the TV's Web Inspector, deploy an unminified build instead:

```sh
IMMICH_TV_DEBUG_BUILD=1 npm run tizen:deploy
```

`npm run build:debug` produces the same unminified `dist/` locally. Redeploy with plain `npm run tizen:deploy` afterwards so the TV runs the production bundle.

## Store Build

Deployment builds a sideload build by default, which includes Settings › Support Us and the splash's support line. A store build, for Samsung's app store, leaves out the tip link entirely (ADR 0021) and must be asked for:

```sh
IMMICH_TV_DISTRIBUTION=store npm run tizen:package
IMMICH_TV_DISTRIBUTION=store npm run check
```

The second command fails if `dist/` or the staged package mentions the tip page. `npm run build:store` makes the same store `dist/` without packaging. Plain `npm run tizen:deploy` goes back to a sideload build.

## Beta Release Package

Beta testers get an **unsigned** package and sign it for their own TV as they install it, with Apps2Samsung or Tizen Studio ([beta-testing.md](beta-testing.md)). Don't publish the package `npm run tizen:package` makes: its `signature1.xml` holds your distributor certificate, which contains your email address and your TVs' DUIDs, and it only installs on those TVs.

1. Start from an up-to-date `main` that has passed CI, and set the version in `config.xml` (`x.y.z`, the format Tizen requires) and `package.json`.
2. Build the sideload package:

   ```sh
   npm run tizen:package:unsigned
   ```

   It writes `.tizen/release/ImmichTV-<version>-unsigned.wgt`: the same 10 runtime files as the signed package, without signature files.
3. Inspect it and take its checksum:

   ```sh
   unzip -l .tizen/release/ImmichTV-<version>-unsigned.wgt
   shasum -a 256 .tizen/release/ImmichTV-<version>-unsigned.wgt
   ```

4. Install it once through Apps2Samsung or Tizen Studio as a tester would, before announcing it.
5. Publish a GitHub release tagged `v<version>-beta.<n>`, marked as a pre-release, with the `.wgt` attached and its SHA-256 and a link to `docs/beta-testing.md` in the notes.

Apps2Samsung's community catalogue lists the app from [`packages/rfsmason__immich-tv-for-samsung.json`](https://github.com/Apps2Samsung/tizen-community-packages/blob/main/packages/rfsmason__immich-tv-for-samsung.json) in its repository. Its scheduled sync copies the newest release: the latest stable release, or the newest pre-release while there is no stable one. From it, the sync takes the asset matching `^ImmichTV-.*-unsigned\.wgt$`. So keep that asset name, attach no second `.wgt` that matches it, and don't publish a signed package. Releases need no change in that repository; changing the name or description does.

The entry's `user_settings` form fills in `scripts/install-preset.js` by finding `serverUrl: ""` and `apiKey: ""` (ADR 0022). `npm run check` fails if either is missing or repeated. If they ever have to change, publish the release first and update the entry straight after: the catalogue ships the newest release, and an install fails when its text is not found.
