// The subset of Samsung's Tizen Web Device APIs this app uses. Everything is
// optional because the desktop preview has no `window.tizen`.

export type TizenInputDeviceKey = {
  code: number;
  name: string;
};

export type TizenTvInputDevice = {
  getSupportedKeys?(): TizenInputDeviceKey[];
  registerKey(name: string): void;
  registerKeyBatch?(names: string[]): void;
};

// Application API (since Tizen 2.0): exit() needs no privilege;
// launchAppControl needs http://tizen.org/privilege/application.launch
// (public). getRequestedAppControl() gives the request the app was last
// launched with, its data as key/value-list pairs.
export type TizenApplicationControlData = { key: string; value: string[] };

export type TizenApplicationManager = {
  getCurrentApplication(): {
    exit(): void;
    getRequestedAppControl?(): {
      appControl?: { data?: TizenApplicationControlData[] };
    } | null;
  };
  launchAppControl?(
    appControl: unknown,
    id: string,
    onsuccess?: () => void,
    onerror?: (error: { message: string; name: string }) => void
  ): void;
};

export type TizenRuntime = {
  ApplicationControl?: new (
    operation: string,
    uri?: string | null,
    mime?: string | null,
    category?: string | null,
    data?: unknown[]
  ) => unknown;
  ApplicationControlData?: new (key: string, value: string[]) => unknown;
  application?: TizenApplicationManager;
  tvinputdevice?: TizenTvInputDevice;
};

// Samsung Product API AppCommon (since product API 2.3, TV; no privilege
// listed), from $WEBAPIS/webapis/webapis.js:
// webapis.appcommon.setScreenSaver(state, onsuccess?, onerror?)
export type SamsungAppCommon = {
  AppCommonScreenSaverState?: { SCREEN_SAVER_OFF: number; SCREEN_SAVER_ON: number };
  setScreenSaver(state: number, onsuccess?: () => void, onerror?: (error: unknown) => void): void;
};

export type SamsungWebApis = {
  appcommon?: SamsungAppCommon;
};

declare global {
  interface Window {
    tizen?: TizenRuntime;
    webapis?: SamsungWebApis;
  }
}
