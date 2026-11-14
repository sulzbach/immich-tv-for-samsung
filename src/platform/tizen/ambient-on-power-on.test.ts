import { describe, expect, it, vi } from "vitest";
import { ambientOnPowerOnServiceId, createAmbientOnPowerOn } from "./ambient-on-power-on";

const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

class Control {
  constructor(
    readonly operation: string,
    readonly uri: string | null,
    readonly mime: string | null,
    readonly category: string | null,
    readonly data: { key: string; value: string[] }[]
  ) {}
}

class ControlData {
  constructor(
    readonly key: string,
    readonly value: string[]
  ) {}
}

function tvWindow(requestData: { key: string; value: string[] }[] = []) {
  const launchAppControl = vi.fn();
  let data = requestData;
  const windowRef = {
    tizen: {
      ApplicationControl: Control,
      ApplicationControlData: ControlData,
      application: {
        getCurrentApplication: () => ({
          exit: vi.fn(),
          getRequestedAppControl: () => ({ appControl: { data } })
        }),
        launchAppControl
      }
    }
  } as unknown as Window;

  return {
    launchAppControl,
    setRequest(next: { key: string; value: string[] }[]) {
      data = next;
    },
    windowRef
  };
}

const request = (nonce: string) => [
  { key: "immich-tv-request", value: [JSON.stringify({ action: "ambient", nonce })] }
];

describe("ambient when the TV turns on", () => {
  it("starts the bundled service with the settings in the launch request", () => {
    const tv = tvWindow();

    createAmbientOnPowerOn(tv.windowRef, logger).configure({ enabled: true });

    const [control, id, onSuccess, onError] = tv.launchAppControl.mock.calls[0]!;
    // Tizen throws when a callback slot is given undefined.
    expect(typeof onSuccess).toBe("function");
    expect(typeof onError).toBe("function");
    expect(id).toBe(ambientOnPowerOnServiceId);
    expect((control as Control).operation).toBe("http://tizen.org/appcontrol/operation/service");
    expect((control as Control).data).toEqual([
      new ControlData("config", [JSON.stringify({ enabled: true })])
    ]);
  });

  it("acts on each ambient request once, not on every return to the front", () => {
    const tv = tvWindow(request("1"));
    const onPowerOn = createAmbientOnPowerOn(tv.windowRef, logger);

    expect(onPowerOn.takeRequest()).toBe(true);
    expect(onPowerOn.takeRequest()).toBe(false);
    tv.setRequest(request("2"));
    expect(onPowerOn.takeRequest()).toBe(true);
  });

  it("ignores a launch without an ambient request, and does nothing off the TV", () => {
    const tv = tvWindow([{ key: "other", value: ["x"] }]);

    expect(createAmbientOnPowerOn(tv.windowRef, logger).takeRequest()).toBe(false);

    const desktop = createAmbientOnPowerOn({} as Window, logger);
    expect(desktop.takeRequest()).toBe(false);
    expect(() => desktop.configure({ enabled: true })).not.toThrow();
  });
});
