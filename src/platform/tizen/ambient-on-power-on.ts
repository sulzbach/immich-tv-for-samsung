import type { Logger } from "../../logging/logger";

// Open when the TV turns on (ADR 0024): the app's half of it. The app starts
// its bundled background service (service/ambient-on-power-on.js) with the
// current setting in the launch request; the service opens the app with a
// request for ambient mode each time the TV comes out of standby. A request
// carries a nonce, so one
// that the app was launched with is acted on once, not again each time the
// app comes back to the front.

export const ambientOnPowerOnServiceId = "imchTV0001.ImmichAmbientService";
const serviceOperation = "http://tizen.org/appcontrol/operation/service";
const requestKey = "immich-tv-request";

export type AmbientOnPowerOnConfig = { enabled: boolean };

export type AmbientOnPowerOn = {
  // Gives the service the current settings, starting it if it isn't running.
  configure(config: AmbientOnPowerOnConfig): void;
  // Whether the app was launched with an ambient request it hasn't acted on.
  takeRequest(): boolean;
};

export function createAmbientOnPowerOn(windowRef: Window, logger: Logger): AmbientOnPowerOn {
  let handledNonce: string | null = null;

  return {
    configure(config) {
      const tizen = windowRef.tizen;
      const Control = tizen && tizen.ApplicationControl;
      const ControlData = tizen && tizen.ApplicationControlData;
      const application = tizen && tizen.application;

      if (!Control || !ControlData || !application || !application.launchAppControl) {
        return;
      }

      try {
        application.launchAppControl(
          new Control(serviceOperation, null, null, null, [
            new ControlData("config", [JSON.stringify(config)])
          ]),
          ambientOnPowerOnServiceId,
          // Tizen rejects undefined where a callback may be given ("Cannot
          // convert undefined to function"), so both are always passed.
          () => undefined,
          (error) => logger.warn("The ambient-on-power-on service didn't start.", error)
        );
      } catch (error) {
        logger.warn("The ambient-on-power-on service couldn't be started.", error);
      }
    },
    takeRequest() {
      const application = windowRef.tizen && windowRef.tizen.application;

      try {
        const current = application && application.getCurrentApplication();
        const requested =
          current && current.getRequestedAppControl ? current.getRequestedAppControl() : null;
        const data = (requested && requested.appControl && requested.appControl.data) || [];
        const item = data.filter((entry) => entry.key === requestKey)[0];
        const parsed = item && item.value[0] ? (JSON.parse(item.value[0]) as unknown) : null;
        const request = parsed as { action?: unknown; nonce?: unknown } | null;

        if (!request || request.action !== "ambient" || typeof request.nonce !== "string") {
          return false;
        }

        if (request.nonce === handledNonce) {
          return false;
        }

        handledNonce = request.nonce;
        return true;
      } catch (error) {
        logger.warn("The app's launch request couldn't be read.", error);
        return false;
      }
    }
  };
}
