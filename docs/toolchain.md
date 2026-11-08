# Samsung Tizen Toolchain

The project starts with a minimal static Tizen Web Application so the Samsung SDK path can be proven on the physical QE55Q950R before application complexity grows.

## Pinned Versions

A fresh machine should match these versions. JavaScript tooling is pinned by `package-lock.json` (commit it with every dependency change) and installed with `npm ci`; never rely on globally installed packages.

| Tool | Version | Where it is pinned |
|---|---|---|
| Node.js | 22.22.0 | `.nvmrc` (CI reads it), `engines` in `package.json` |
| npm | 10 or later (lockfile v3) | `engines` in `package.json` |
| TypeScript, esbuild, ESLint, Vitest, Prettier | exact resolved versions | `package-lock.json` |
| Playwright (desktop capture library only) | 1.64.1 | exact dev dependency and `package-lock.json`; install Chromium with `npx playwright install chromium` |
| Browser target | Chromium 63 (Tizen 5.0) | `browserslist` in `package.json`, esbuild `chrome63` |
| Tizen Studio SDK | 10.0 | this table |
| Tizen CLI (`tizen`) | 2.5.25 | this table |
| Smart Development Bridge (`sdb`) | 4.2.36 | this table |
| TV Extensions (`TV-SAMSUNG-Public`, `TV-SAMSUNG-Public-WebAppDevelopment`, `TV-SAMSUNG-Extension-Tools`, `TV-SAMSUNG-Extension-Resources`) | 10.0.0 | this table |
| Samsung Certificate Extension (`cert-add-on`) | 2.0.75 | this table |
| Certificate Manager (`Certificate-Manager`) | 3.1.3 | this table |

The Tizen entries were recorded from the development Mac on 15 October 2026. The TV Extensions 10.0 tooling still packages and installs the `required_version="5.0"` widget for the Tizen 5.0 Q950R. Re-check after any Tizen Studio update with:

```sh
cat "$HOME/tizen-studio/sdk.version"
"$HOME/tizen-studio/tools/ide/bin/tizen" version
"$HOME/tizen-studio/tools/sdb" version
"$HOME/tizen-studio/package-manager/package-manager-cli.bin" show-pkgs
```

In the `show-pkgs` output, installed packages are marked `i`.

## Required Tools

Install Tizen Studio and include:

- Web CLI
- Samsung TV Extension / TV Extension Tools
- Samsung Certificate Extension

Samsung documents the CLI as supporting build, package, install, run, and uninstall workflows for TV applications. A valid certificate profile is required before packaging, and installation on a TV also requires permitting installs for the connected device in Device Manager.

## Command Locations

Tizen Studio installs its tools outside `PATH`. Either add `$HOME/tizen-studio/tools` and `$HOME/tizen-studio/tools/ide/bin` to `PATH`, or call `sdb` and `tizen` by absolute path as the deploy runbook does.

## Device Discovery

Once the TV is in Developer Mode and reachable from the Mac:

```sh
sdb devices
```

The target name or serial from that command is used by the Tizen CLI install and run commands.

## Build And Package

From the project root:

```sh
npm run tizen:package
```

This builds `dist/`, copies the runtime files into `.tizen/package-src/.buildResult` and signs them there with `tizen package -t wgt -s <certificate-profile>`. It does not call `tizen build-web`: the bundle is already built, and `build-web` fails on a Web CLI-only Tizen Studio install (`NoClassDefFoundError: org/eclipse/core/runtime/Plugin`).

TV applications install as `.wgt` packages.

## Install And Run

For the physical Q950R, prefer the project deploy runbook:

```sh
npm run tizen:deploy
```

See [tizen-deploy-runbook.md](tizen-deploy-runbook.md) for the machine-specific settings (`.env.tizen`), stale-SDB recovery steps, and manual command sequence.

Use the target shown by `sdb devices`:

```sh
tizen install -t <target-name> --name ImmichTV.wgt -- .
tizen run -t <target-name> -p imchTV0001.ImmichTV
```

If installation fails, first check that `config.xml` contains both the package and application ID.

## Engine Verification

Samsung's web engine specification lists Tizen 5.0 (2019) as Chromium M63. The physical Q950R remains authoritative, so confirm the engine on the TV itself.

1. Deploy the app (`npm run tizen:deploy`) and open the Web Inspector for the running app, as described in Samsung's debugging guide.
2. In the inspector console, run each line and record the result below:

```js
navigator.userAgent
CSS.supports('gap', '1px')
'toggleAttribute' in Element.prototype
```

Expected on Chromium 63: the user agent contains `Chrome/63`, `CSS.supports('gap', '1px')` is `false`, and `'toggleAttribute' in Element.prototype` is `false`. If the TV reports anything different, treat the TV's answer as authoritative and update the compatibility checks.

| Check | Result on QE55Q950RBTXXU | Date recorded |
|---|---|---|
| `navigator.userAgent` | _pending_ | |
| `CSS.supports('gap', '1px')` | _pending_ | |
| `'toggleAttribute' in Element.prototype` | _pending_ | |

## Runtime Compatibility Enforcement

The runtime target is declared once as the `browserslist` entry `chrome 63` in `package.json`.

- `npm run lint` runs ESLint with `eslint-plugin-compat` (unsupported globals and ES built-ins), `scripts/check-css-compat.mjs` (CSS properties, selectors and functions Chromium 63 ignores) and `scripts/check-js-compat.mjs` (DOM members such as `toggleAttribute` that ESLint cannot see on element instances).
- `npm run check` repeats the DOM-member denylist against the built `dist/scripts/main.js`.
- `tsconfig.json` limits the ECMAScript library to ES2017, so newer built-ins such as `Array.prototype.flat` are type errors. TypeScript's DOM library cannot be limited to a browser version, which is why the DOM-member denylist exists.

## Known Platform Behaviour

- `element.focus({ preventScroll: true })` needs Chrome 64. Chromium 63 accepts the call but ignores the option, so focusing can scroll the page. Screens therefore correct grid and rail scroll positions manually after focusing; never rely on `preventScroll` alone.
- CSS `gap` needs Chrome 66 for grid and Chrome 84 for flexbox. Grid rules carry an equal `grid-gap` fallback, and flex rows use adjacent-sibling margins.

## Networking Note

Milestone 1 did not request network privileges. Milestone 2 added Immich API connectivity, so `config.xml` now declares the Internet privilege and an external access policy for configured server origins.
