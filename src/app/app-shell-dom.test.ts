// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { remoteKeys } from "../platform/tizen/keys";
import {
  mountExitConfirmation,
  type ExitConfirmationController
} from "../screens/exit-confirmation";
import { byId, loadAppMarkup, pressKey } from "../test/app-markup";
import {
  mountApplicationShell,
  type ApplicationShellController,
  type ShellScreenController,
  type TopLevelDestinationId
} from "./app-shell";

const destinations: TopLevelDestinationId[] = ["home", "photos", "albums", "search", "settings"];
let shell: ApplicationShellController | null = null;
let dialog: ExitConfirmationController | null = null;
const cleanups: Array<() => void> = [];

// A focusable control inside a screen's content.
function contentControl(): HTMLButtonElement {
  const control = document.createElement("button");
  control.className = "focusable";
  byId("albums-screen").appendChild(control);
  return control;
}

function railButton(destination: TopLevelDestinationId): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-destination="${destination}"]`)!;
}

function mountShell(
  overrides: {
    onRootBack?(destination: TopLevelDestinationId | null): void;
    onRefresh?(): void;
    guard?(): boolean;
  } = {}
) {
  const screens = {} as Record<TopLevelDestinationId, ShellScreenController & { shown: number }>;

  for (const destination of destinations) {
    const screen = {
      focusContent: vi.fn(),
      hide: vi.fn(),
      show: vi.fn(() => {
        screen.shown += 1;
      }),
      shown: 0
    };
    screens[destination] = screen;
  }

  shell = mountApplicationShell({
    onBeforeDestinationActivated: (from) =>
      from === "settings" && overrides.guard ? overrides.guard() : true,
    onRefresh: overrides.onRefresh,
    onRootBack: overrides.onRootBack,
    screens
  });

  return screens;
}

beforeEach(() => {
  loadAppMarkup();
});

afterEach(() => {
  shell?.destroy();
  dialog?.destroy();
  shell = null;
  dialog = null;
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

describe("shell rail navigation", () => {
  it("covers the app with the splash, holding keys back until it is hidden", () => {
    const screens = mountShell();
    shell!.activateDestination("home");
    shell!.hideSplash();
    const splash = document.getElementById("splash-screen")!;
    const before = screens.home.shown;

    shell!.coverWithSplash();
    expect(splash.hidden).toBe(false);
    expect(shell!.isSplashVisible()).toBe(true);
    const key = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, keyCode: 40 });
    railButton("home").dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);

    shell!.hideSplash();
    expect(splash.hidden).toBe(true);
    expect(screens.home.shown).toBe(before);
  });

  it("activates destinations with Up/Down and hands focus to content with Right", () => {
    const screens = mountShell();

    shell!.activateDestination("home");
    expect(document.activeElement).toBe(railButton("home"));
    pressKey(remoteKeys.down);
    expect(document.activeElement).toBe(railButton("photos"));
    expect(screens.photos.show).toHaveBeenCalledTimes(1);
    expect(screens.home.hide).toHaveBeenCalled();
    expect(railButton("photos").getAttribute("aria-current")).toBe("page");

    pressKey(remoteKeys.right);
    expect(screens.photos.focusContent).toHaveBeenCalledTimes(1);
  });

  it("collapses the rail when focus moves into a screen and expands it on return", () => {
    const screens = mountShell();
    const content = contentControl();
    screens.albums.focusContent = vi.fn(() => content.focus());
    const rail = () => byId("app-shell").getAttribute("data-rail");

    shell!.activateDestination("albums");
    expect(document.activeElement).toBe(railButton("albums"));
    expect(rail()).not.toBe("compact");

    pressKey(remoteKeys.right);
    expect(document.activeElement).toBe(content);
    expect(rail()).toBe("compact");

    shell!.focusActiveDestinationNav();
    expect(document.activeElement).toBe(railButton("albums"));
    expect(rail()).toBe("expanded");
  });

  it("hides the rail while the viewer's buttons are hidden, and shows it again", () => {
    mountShell();
    const root = byId("app-shell");

    shell!.setRailHidden(true);
    expect(root.getAttribute("data-rail-hidden")).toBe("true");
    shell!.setRailHidden(false);
    expect(root.hasAttribute("data-rail-hidden")).toBe(false);
  });

  it("reaches Refresh below Settings without changing screen, and OK refreshes", () => {
    const onRefresh = vi.fn();
    const screens = mountShell({ onRefresh });

    shell!.activateDestination("settings");
    pressKey(remoteKeys.down);
    expect(document.activeElement).toBe(byId("rail-refresh"));
    expect(railButton("settings").getAttribute("aria-current")).toBe("page");
    expect(screens.settings.hide).not.toHaveBeenCalled();

    pressKey(remoteKeys.down);
    expect(document.activeElement).toBe(byId("rail-refresh"));
    pressKey(remoteKeys.enter);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    pressKey(remoteKeys.right);
    expect(screens.settings.focusContent).toHaveBeenCalledTimes(1);

    byId("rail-refresh").focus();
    pressKey(remoteKeys.up);
    expect(document.activeElement).toBe(railButton("settings"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the Settings guard on rail navigation", () => {
    const guard = vi.fn(() => false);
    const screens = mountShell({ guard });

    shell!.activateDestination("settings");
    pressKey(remoteKeys.up);

    expect(guard).toHaveBeenCalledTimes(1);
    expect(screens.search.show).not.toHaveBeenCalled();
  });
});

describe("Back at the application root", () => {
  it("routes Back on the rail to the root handler before any screen can consume it", () => {
    const onRootBack = vi.fn();
    mountShell({ onRootBack });
    // Screens such as Home stop propagation after handling Back.
    const screenBack = vi.fn((event: KeyboardEvent) => event.stopImmediatePropagation());
    document.addEventListener("keydown", screenBack);
    cleanups.push(() => document.removeEventListener("keydown", screenBack));

    shell!.activateDestination("albums");
    pressKey(remoteKeys.back);

    expect(onRootBack).toHaveBeenCalledWith("albums");
    expect(screenBack).not.toHaveBeenCalled();
  });

  it("leaves Back inside screen content to the screen", () => {
    const onRootBack = vi.fn();
    mountShell({ onRootBack });
    const screenBack = vi.fn();
    document.addEventListener("keydown", screenBack);
    cleanups.push(() => document.removeEventListener("keydown", screenBack));

    shell!.activateDestination("albums");
    contentControl().focus();
    pressKey(remoteKeys.back);

    expect(onRootBack).not.toHaveBeenCalled();
    expect(screenBack).toHaveBeenCalledTimes(1);
  });

  it("confirms before exiting, defaults to staying, and Back closes the popup", () => {
    const onExit = vi.fn();
    dialog = mountExitConfirmation({ onExit });
    mountShell({ onRootBack: () => dialog!.open() });
    const screenKeys = vi.fn();
    document.addEventListener("keydown", screenKeys);
    cleanups.push(() => document.removeEventListener("keydown", screenKeys));

    shell!.activateDestination("home");
    pressKey(remoteKeys.back);

    expect(byId("exit-dialog").hidden).toBe(false);
    expect(document.activeElement).toBe(byId("exit-dialog-stay"));

    pressKey(remoteKeys.down);
    pressKey(remoteKeys.back);
    expect(byId("exit-dialog").hidden).toBe(true);
    expect(document.activeElement).toBe(railButton("home"));
    expect(onExit).not.toHaveBeenCalled();
    expect(screenKeys).not.toHaveBeenCalled();

    pressKey(remoteKeys.back);
    pressKey(remoteKeys.enter);
    expect(onExit).not.toHaveBeenCalled();
    expect(byId("exit-dialog").hidden).toBe(true);

    pressKey(remoteKeys.back);
    pressKey(remoteKeys.right);
    expect(document.activeElement).toBe(byId("exit-dialog-exit"));
    pressKey(remoteKeys.enter);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
