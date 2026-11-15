import type { Logger } from "../../logging/logger";

// Open when the TV turns on (ADR 0024): the app's half of it. The app starts
// its bundled background service (service/ambient-on-power-on.js) with the
// current setting in the launch request. Each time the TV comes out of
// standby, the service asks for ambient mode two ways, with one nonce:
// - a message on the app's local message port, which reaches the app while it
//   runs, even when it is already in front: the TV gives an app it brings
//   back by itself no other sign of a new launch request;
// - a launch request, which opens the app, or brings it to the front.
// Each nonce is acted on once, whichever way arrives first.
//
// When the app comes back to the front, it can also ask the service whether
// the TV is just turning on: the TV brings the app back before the service's
// next check sees the power-on. The service answers on the same port.

export const ambientOnPowerOnServiceId = "imchTV0001.ImmichAmbientService";
const serviceOperation = "http://tizen.org/appcontrol/operation/service";
const requestKey = "immich-tv-request";
// The app's port, which the service sends to, and the service's.
export const ambientAppPortName = "immich-tv-ambient";
export const ambientServicePortName = "immich-tv-ambient-service";

export type AmbientOnPowerOnConfig = { enabled: boolean };

// "ambient": a request not acted on yet. "none": the service's answer that
// the TV isn't turning on.
export type AmbientServiceMessage = "ambient" | "none";

export type AmbientOnPowerOn = {
  // Gives the service the current settings, starting it if it isn't running.
  configure(config: AmbientOnPowerOnConfig): void;
  // Whether the app was launched with an ambient request it hasn't acted on.
  takeRequest(): boolean;
  // Calls `listener` with each message from the service while the app runs.
  // Returns the unsubscribe.
  listen(listener: (message: AmbientServiceMessage) => void): () => void;
  // Asks the service whether the TV is just turning on; it answers through
  // listen. False when it couldn't be asked (no service, or off the TV).
  askIfTurningOn(): boolean;
};

export function createAmbientOnPowerOn(windowRef: Window, logger: Logger): AmbientOnPowerOn {
  let handledNonce: string | null = null;

  // Whether a request with this nonce is new; it is then marked handled.
  function isNew(nonce: unknown): boolean {
    if (typeof nonce !== "string" || nonce === handledNonce) {
      return false;
    }

    handledNonce = nonce;
    return true;
  }

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

        return Boolean(request && request.action === "ambient" && isNew(request.nonce));
      } catch (error) {
        logger.warn("The app's launch request couldn't be read.", error);
        return false;
      }
    },
    listen(listener) {
      const messageport = windowRef.tizen && windowRef.tizen.messageport;

      if (!messageport) {
        return () => undefined;
      }

      try {
        const port = messageport.requestLocalMessagePort(ambientAppPortName);
        const id = port.addMessagePortListener((data) => {
          const value = (key: string) => {
            const item = (data || []).filter((entry) => entry.key === key)[0];
            return item ? item.value : null;
          };
          const action = value("action");

          if (action === "none") {
            listener("none");
          } else if (action === "ambient" && isNew(value("nonce"))) {
            listener("ambient");
          }
        });

        return () => port.removeMessagePortListener(id);
      } catch (error) {
        logger.warn("The ambient-on-power-on message port couldn't be opened.", error);
        return () => undefined;
      }
    },
    askIfTurningOn() {
      const messageport = windowRef.tizen && windowRef.tizen.messageport;

      if (!messageport) {
        return false;
      }

      try {
        messageport
          .requestRemoteMessagePort(ambientOnPowerOnServiceId, ambientServicePortName)
          .sendMessage([{ key: "query", value: "turning-on" }]);
        return true;
      } catch (error) {
        // The service isn't running.
        logger.warn("The ambient-on-power-on service couldn't be asked.", error);
        return false;
      }
    }
  };
}
