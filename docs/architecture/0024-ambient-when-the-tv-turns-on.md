# 0024 - Ambient When the TV Turns On

## Context

On Google TV, ambient photos take over when the TV sits idle anywhere, because Android lets an app be the system screensaver. A household wanted the same on a Samsung TV. Their main complaint was Samsung TV Plus opening by itself, on channels they never chose. Ambient mode's Start after idle (ADR 0019) only counts while Immich TV is open in front, so it can't help with that.

### What the documentation and community offer

Researched in November 2026, against Samsung's developer documentation, Tizen docs, Samsung support pages, and community projects (Home Assistant `samsungtv`, `samsung-tv-ws-api`, TizenBrew, the Samsung developer forum):

| Option | Outcome for a sideloaded app on a 2023 TV |
|---|---|
| Register as the TV's screensaver | No API. AppCommon `setScreenSaver` only stops the TV's own screensaver while the app is in front |
| An autostart key in `config.xml` | Not documented |
| Samsung Ambient Mode / Art Mode | Not open to third-party content |
| Tizen web service (`tizen:service`), background launch | Documented as partner-level for TVs, but it worked with a developer certificate (see below). TizenBrew relies on the same thing |
| Alarm API to relaunch the app | Public privilege. Not pursued: there is nothing idle-related to schedule it from |
| "Autorun Last App" (TV setting) | Reopens whatever was last in front at power-on. User setting, not something the app controls |
| SmartThings `launchApp`, Home Assistant automations | Need a cloud account or a home server. Ruled out by the project's "no additional backend" principle |
| HDMI-CEC | Turns the TV on and switches input. Opens no apps |
| LAN REST API on port 8001 | Undocumented by Samsung, widely used by Home Assistant. Gives power state and per-app status; launches apps |

### What was measured on the TV

Spike on a 2023 UN50CU8000 (Tizen 8.0, developer certificate, wired):

- A service bundled with the app starts (Node v16.17.1) when the app launches it with `launchAppControl`. It keeps running with the app hidden, with YouTube in front, and across standby: its uptime was unbroken after power off and Wake-on-LAN. Tizen rejects `undefined` for the success callback ("Cannot convert undefined to function"), so the service never started until both callbacks were functions.
- From inside the TV, `127.0.0.1:8001/api/v2/` answers `device.PowerState`, and `/api/v2/applications/{id}` answers `running` and `visible` for one app. `POST` to the same path launches it, sideloaded apps included. That API only knows apps by their store ID. System screens (Home, Live TV `org.tizen.tv-viewer`) answer 404, and nothing lists the installed apps' store IDs.
- `tizen.application.getAppsContext` lists every running process, preloaded apps and system screens included, so it can't say what is in front. Its IDs aren't store IDs either: YouTube runs as `com.samsung.tv.cobalt-yt` but the REST API knows it as `111299001912`. A first version that checked each running process against the REST API therefore missed YouTube and opened ambient mode over it.
- `addAppStatusChangeListener` registered but reported no other app's changes. `tizen.tvwindow` and `tizen.tvchannel` are absent from a service. `webapis.hybridchannelinfo.getCurrentChannel` and `getAppsUsageInfo` answer NotSupportedError. `tizen.systeminfo` `VIDEOSOURCE` lists the HDMI inputs with something plugged in, but not which is shown.
- The WebSocket remote API on port 8002 (TLS, paired token) sends keys but answered nothing to `ed.installedApp.get`. No source shows remote key presses to a service.
- `launchAppControl` brings the app to the front over Home and over YouTube.

So a service can't tell "the TV is idle on its Home screen" from "an app the service doesn't know is in front". The only way would be a hand-kept list of store IDs. That breaks for every new app, differs between TVs and regions, and isn't acceptable for other Immich users. A first version built on "idle on Home for N minutes" was dropped for that reason.

The TV's power state, on the other hand, is reliable: the API answers `standby` while the TV is off, then `on`.

### What was measured turning the TV on

With the first power-on version on the TV, a quick power off and on left Immich TV on its menu, and a longer one first showed the menu, then ambient mode. Diagnostics from the service and the app (a temporary local log, not kept) showed, on each power-on:

- The TV brings back by itself whatever was in front before standby, Immich TV included: about 1.4 s **before** the service's next check saw `on`. The app, back in front, found no request yet.
- The service's `launchAppControl` then succeeded, but an app already in front got no sign of it: no visibility change and no window `appcontrol` event. That stayed so with an `app-control` declared in `config.xml` for the service's operation, with `reload="disable"`, as Samsung documents for Smart Hub Preview deep links. The request was lost.
- A message from the service on the app's local message port (Message Port API, no privilege) reached the running app, in front or not, in about 0.2 s.
- In a quiet start, ambient mode shows only once its first picture is ready. Meanwhile the splash had gone as Home loaded, so the menu showed in between.

Which app the TV brings back depends on how long it was off: after a short standby, the one in front before; after a longer one, Smart Hub, which may open Samsung TV Plus. After a restart, or when the TV closes background apps to free memory, the app and its service are gone until the app is opened again.

## Decision

- **Open when the TV turns on** (Settings → Ambient, off by default). Each time the TV comes out of standby, Immich TV opens into ambient mode. It takes the place of Samsung TV Plus or the Home screen, and any key stops it.
- **A bundled web service** (`service/ambient-on-power-on.js`, `imchTV0001.ImmichAmbientService`) reads `PowerState` from `127.0.0.1:8001/api/v2/` every 2 seconds. The TV has turned on when the answer is `on` after another state, or after more than 20 seconds without an `on` answer, since in standby the service's timers may not run and the API may not answer. It then asks for ambient mode two ways, with one nonce: a message on the app's message port (`immich-tv-ambient`), which reaches the running app even in front, and `launchAppControl` with `{"action":"ambient","nonce":…}`, which opens the app or brings it to the front. The app acts on each nonce once.
- **The app asks back.** When it comes to the front with the option on, it keeps the splash up and asks on the service's port (`immich-tv-ambient-service`) whether the TV is just turning on. The service answers from what it saw last (`standby`, or no `on` for 20 seconds): with the same request, or with `none`, and the splash goes at once. With no answer within 3 seconds (no service), it goes anyway.
- **Splash first, then the first picture.** The splash covers the app as it goes to the background with the option on, so the TV never brings back the menu first, and while ambient mode opens. Ambient mode starts quietly and stays see-through over the splash (`data-over-splash`) until its first picture has faded in, so the splash fades straight into the picture. Remote keys are held back while the splash covers the app.
- **The app starts the service** on launch and whenever Settings are saved, passing `{"enabled"}` in the launch request (`src/platform/tizen/ambient-on-power-on.ts`), and starts ambient mode with the saved settings (`AmbientController.startIdle`).
- `config.xml` declares the service, `http://tizen.org/feature/web.service`, `background-support="enable"` and the public `http://tizen.org/privilege/application.launch`. The Message Port API needs no privilege. Packaging stages ten runtime files.

## Consequences

- It opens every time the TV turns on, whatever the TV would have shown: Samsung TV Plus, Home, Live TV, or an HDMI device that turned the TV on over HDMI-CEC. A key press leaves ambient mode into Immich TV. That is why it is off by default.
- With the option on, coming back to Immich TV from another app shows the splash for as long as the service takes to answer: one local API request, at most 3 seconds.
- It does nothing while the TV stays on. "Idle on Home" can't be detected (see Context), so ambient mode over an idle Home screen is out of reach.
- The service runs only once the app has launched it since the TV last started from cold (restart or unplugged), or since the TV closed the app to free memory. Standby keeps it running. "Autorun Last App" on the TV covers a cold start.
- If the local API stops answering for more than 20 seconds while the TV is on, the next answer counts as a power-on. That has not been seen.
- The TV's local API on port 8001 is undocumented by Samsung and may change with firmware. When it stops answering, the service does nothing. The service and the app open no network port.
- Samsung documents TV web services as partner-level. On the test TV a developer certificate was enough. A store build would need Samsung's review of the service.
