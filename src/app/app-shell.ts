import { getKeyCode, remoteKeys } from "../platform/tizen/keys";

export type TopLevelDestinationId = "albums" | "home" | "photos" | "search" | "settings";

export type ShellScreenController = {
  focusContent(): void;
  hide(): void;
  show(): void;
};

export type ShellContentFocusController = {
  focusContent(): void;
};

export type DestinationActivationOptions = {
  bypassGuard?: boolean;
  // false keeps the splash up and leaves focus alone, so a destination can
  // load behind it; revealApp() then shows it.
  reveal?: boolean;
};

export type ApplicationShellOptions = {
  documentRef?: Document;
  onBeforeDestinationActivated?(
    fromDestination: TopLevelDestinationId,
    toDestination: TopLevelDestinationId
  ): boolean;
  onDestinationActivated?(destination: TopLevelDestinationId): void;
  // Back pressed while focus is on the top-level navigation rail: the
  // application's root, where Samsung expects an exit confirmation.
  onRootBack?(activeDestination: TopLevelDestinationId | null): void;
  // OK on the rail's Refresh: reload every screen's data.
  onRefresh?(): void;
  onSettingsBack?(): void;
  screens: Record<TopLevelDestinationId, ShellScreenController>;
};

type ApplicationShellElements = {
  rail: HTMLElement;
  refresh: HTMLButtonElement;
  root: HTMLElement;
  splash: HTMLElement;
  splashError: HTMLElement;
  splashStatus: HTMLElement;
};

type ApplicationShellState = {
  activeDestination: TopLevelDestinationId | null;
  // A destination is loading behind the splash (activated with reveal false);
  // remote keys are ignored until revealApp().
  loadingBehindSplash: boolean;
  contentFocusController: ShellContentFocusController | null;
  previousTopLevelDestination: TopLevelDestinationId | null;
};

export type ApplicationShellController = {
  activateDestination(
    destination: TopLevelDestinationId,
    options?: DestinationActivationOptions
  ): void;
  collapseRail(): void;
  // Puts the splash back up over the app, holding remote keys back as while
  // loading, until hideSplash or revealApp (ADR 0024).
  coverWithSplash(): void;
  destroy(): void;
  expandRail(): void;
  focusActiveContent(): void;
  focusActiveDestinationNav(): void;
  isSplashVisible(): boolean;
  hideSplash(): void;
  // Hides the splash and focuses the active destination in the rail.
  revealApp(): void;
  routeBackFromSettings(options?: DestinationActivationOptions): void;
  // Hides the rail while the viewer's own buttons are hidden, so nothing
  // but the picture shows during a slideshow or video.
  setRailHidden(hidden: boolean): void;
  setContentFocusController(controller: ShellContentFocusController | null): void;
  setSplashStatus(message: string): void;
  showSplashError(message: string): void;
};

const lastDestination: TopLevelDestinationId = "settings";

const topLevelDestinations: TopLevelDestinationId[] = [
  "home",
  "photos",
  "albums",
  "search",
  "settings"
];

export function getTopLevelDestinationByOffset(
  currentDestination: TopLevelDestinationId,
  offset: number
): TopLevelDestinationId {
  const currentIndex = topLevelDestinations.indexOf(currentDestination);
  const baseIndex = currentIndex < 0 ? 0 : currentIndex;
  const nextIndex = Math.max(0, Math.min(topLevelDestinations.length - 1, baseIndex + offset));

  return topLevelDestinations[nextIndex] || "home";
}

export function getNextRailDestination(input: {
  activeDestination: TopLevelDestinationId | null;
  focusedDestination: TopLevelDestinationId | null;
  offset: number;
}): TopLevelDestinationId {
  return getTopLevelDestinationByOffset(
    input.activeDestination || input.focusedDestination || "home",
    input.offset
  );
}

export function getSettingsBackDestination(
  previousDestination: TopLevelDestinationId | null
): TopLevelDestinationId {
  return previousDestination && previousDestination !== "settings" ? previousDestination : "albums";
}

export function isTopLevelDestinationId(value: string | null): value is TopLevelDestinationId {
  return (
    value === "albums" ||
    value === "home" ||
    value === "photos" ||
    value === "search" ||
    value === "settings"
  );
}

export function resolveContentFocusController(input: {
  activeDestination: TopLevelDestinationId | null;
  contentFocusController: ShellContentFocusController | null;
  screens: Record<TopLevelDestinationId, ShellScreenController>;
}): ShellContentFocusController | null {
  if (input.contentFocusController) {
    return input.contentFocusController;
  }

  return input.activeDestination ? input.screens[input.activeDestination] : null;
}

export function shouldAllowDestinationActivation(input: {
  activeDestination: TopLevelDestinationId | null;
  bypassGuard?: boolean;
  destination: TopLevelDestinationId;
  onBeforeDestinationActivated?: ApplicationShellOptions["onBeforeDestinationActivated"];
}): boolean {
  if (
    input.bypassGuard ||
    !input.activeDestination ||
    input.activeDestination === input.destination
  ) {
    return true;
  }

  return input.onBeforeDestinationActivated
    ? input.onBeforeDestinationActivated(input.activeDestination, input.destination)
    : true;
}

export function mountApplicationShell(
  options: ApplicationShellOptions
): ApplicationShellController {
  const documentRef = options.documentRef || document;
  const elements = readElements(documentRef);
  const state: ApplicationShellState = {
    activeDestination: null,
    contentFocusController: null,
    loadingBehindSplash: false,
    previousTopLevelDestination: null
  };

  const handleRailKeydown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;

    if (!target || !elements.rail.contains(target)) {
      return;
    }

    handleRailNavigation(event, elements, options, state);
  };

  // Capture phase: screens' own document listeners treat Back as "return to
  // the rail" and some stop propagation, so the rail must see it first.
  const handleRootBack = (event: KeyboardEvent) => {
    const target = event.target as Node | null;

    if (getKeyCode(event) !== remoteKeys.back || !target || !elements.rail.contains(target)) {
      return;
    }

    event.preventDefault();
    stopEvent(event);
    event.stopPropagation();
    options.onRootBack?.(state.activeDestination);
  };

  // The rail follows remote focus: it collapses as soon as focus moves into a
  // screen (Right from the rail, or any route that focuses content) and
  // expands again when focus returns to it (Left, Back).
  const handleFocusIn = (event: FocusEvent) => {
    const target = event.target as Node | null;

    if (!target) {
      return;
    }

    if (elements.rail.contains(target)) {
      elements.root.setAttribute("data-rail", "expanded");
    } else if (elements.root.contains(target)) {
      elements.root.setAttribute("data-rail", "compact");
    }
  };

  const handleRailClick = (event: MouseEvent) => {
    if (elements.refresh.contains(event.target as Node | null)) {
      event.preventDefault();
      options.onRefresh?.();
      return;
    }

    const destination = readDestinationFromTarget(event.target);

    if (!destination) {
      return;
    }

    event.preventDefault();
    activateDestination(destination, elements, options, state);
  };

  // While a destination loads behind the splash, remote keys must not reach
  // it: Back would focus the hidden rail, OK could open another destination,
  // and a second Back would open the exit dialog under the splash. Listening
  // on the window in the capture phase runs before every document listener.
  const keyTarget: EventTarget = documentRef.defaultView || documentRef;
  const handleKeysBehindSplash = (event: Event) => {
    if (!state.loadingBehindSplash) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
  };

  keyTarget.addEventListener("keydown", handleKeysBehindSplash, true);
  keyTarget.addEventListener("keyup", handleKeysBehindSplash, true);
  documentRef.addEventListener("keydown", handleRootBack, true);
  documentRef.addEventListener("keydown", handleRailKeydown);
  documentRef.addEventListener("focusin", handleFocusIn);
  elements.rail.addEventListener("click", handleRailClick);

  return {
    activateDestination(destination, activationOptions = {}) {
      activateDestination(destination, elements, options, state, activationOptions);
    },
    collapseRail() {
      elements.root.setAttribute("data-rail", "compact");
    },
    destroy() {
      keyTarget.removeEventListener("keydown", handleKeysBehindSplash, true);
      keyTarget.removeEventListener("keyup", handleKeysBehindSplash, true);
      documentRef.removeEventListener("keydown", handleRootBack, true);
      documentRef.removeEventListener("keydown", handleRailKeydown);
      documentRef.removeEventListener("focusin", handleFocusIn);
      elements.rail.removeEventListener("click", handleRailClick);
    },
    expandRail() {
      elements.root.setAttribute("data-rail", "expanded");
    },
    focusActiveContent() {
      const controller = resolveContentFocusController({
        activeDestination: state.activeDestination,
        contentFocusController: state.contentFocusController,
        screens: options.screens
      });

      if (controller) {
        controller.focusContent();
      } else {
        focusDestinationNav(elements, state.activeDestination);
      }
    },
    focusActiveDestinationNav() {
      focusDestinationNav(elements, state.activeDestination);
    },
    coverWithSplash() {
      state.loadingBehindSplash = true;
      elements.splash.hidden = false;
    },
    hideSplash() {
      state.loadingBehindSplash = false;
      hideSplash(elements);
    },
    isSplashVisible: () => !elements.splash.hidden,
    // Does nothing once the splash has gone, so it can't move focus later.
    revealApp() {
      if (elements.splash.hidden) {
        return;
      }

      state.loadingBehindSplash = false;
      hideSplash(elements);
      focusDestinationNav(elements, state.activeDestination);
    },
    routeBackFromSettings(activationOptions = {}) {
      const destination = getSettingsBackDestination(state.previousTopLevelDestination);

      activateDestination(destination, elements, options, state, activationOptions);
    },
    setRailHidden(hidden) {
      if (hidden) {
        elements.root.setAttribute("data-rail-hidden", "true");
      } else {
        elements.root.removeAttribute("data-rail-hidden");
      }
    },
    setContentFocusController(controller) {
      state.contentFocusController = controller;
    },
    setSplashStatus(message) {
      elements.splashStatus.textContent = message;
    },
    showSplashError(message) {
      state.loadingBehindSplash = false;
      elements.splashStatus.textContent = "Startup needs attention.";
      elements.splashError.textContent = message;
      elements.splash.removeAttribute("data-state");
    }
  };
}

function readElements(documentRef: Document): ApplicationShellElements {
  return {
    rail: requireElement(documentRef, "top-nav"),
    refresh: requireElement<HTMLButtonElement>(documentRef, "rail-refresh"),
    root: requireElement(documentRef, "app-shell"),
    splash: requireElement(documentRef, "splash-screen"),
    splashError: requireElement(documentRef, "splash-error"),
    splashStatus: requireElement(documentRef, "splash-status")
  };
}

function requireElement<T extends HTMLElement>(documentRef: Document, id: string): T {
  const element = documentRef.getElementById(id);

  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }

  return element as T;
}

function handleRailNavigation(
  event: KeyboardEvent,
  elements: ApplicationShellElements,
  options: ApplicationShellOptions,
  state: ApplicationShellState
): void {
  const keyCode = getKeyCode(event);

  // Refresh sits below Settings: Down from Settings reaches it without
  // changing screen, Up from it returns to Settings, and OK refreshes.
  if (event.target === elements.refresh) {
    if (keyCode === remoteKeys.up) {
      event.preventDefault();
      stopEvent(event);
      activateDestination(lastDestination, elements, options, state);
    } else if (keyCode === remoteKeys.enter) {
      event.preventDefault();
      stopEvent(event);
      options.onRefresh?.();
    } else if (keyCode === remoteKeys.down) {
      event.preventDefault();
      stopEvent(event);
    }

    if (keyCode !== remoteKeys.right) {
      return;
    }
  } else if (keyCode === remoteKeys.down && readFocusedDestination(elements) === lastDestination) {
    event.preventDefault();
    stopEvent(event);
    elements.refresh.focus();
    return;
  }

  if (keyCode === remoteKeys.up || keyCode === remoteKeys.down) {
    event.preventDefault();
    stopEvent(event);
    const destination = getNextRailDestination({
      activeDestination: state.activeDestination,
      focusedDestination: readFocusedDestination(elements),
      offset: keyCode === remoteKeys.up ? -1 : 1
    });

    activateDestination(destination, elements, options, state);
    return;
  }

  if (keyCode === remoteKeys.enter) {
    const destination = readDestinationFromTarget(event.target);

    if (destination) {
      event.preventDefault();
      stopEvent(event);
      activateDestination(destination, elements, options, state);
    }

    return;
  }

  if (keyCode === remoteKeys.right) {
    event.preventDefault();
    stopEvent(event);

    const controller = resolveContentFocusController({
      activeDestination: state.activeDestination,
      contentFocusController: state.contentFocusController,
      screens: options.screens
    });

    if (controller) {
      controller.focusContent();
    }
  }
}

function stopEvent(event: Event): void {
  event.stopPropagation();

  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }
}

function activateDestination(
  destination: TopLevelDestinationId,
  elements: ApplicationShellElements,
  options: ApplicationShellOptions,
  state: ApplicationShellState,
  activationOptions: DestinationActivationOptions = {}
): void {
  if (
    !shouldAllowDestinationActivation({
      activeDestination: state.activeDestination,
      bypassGuard: activationOptions.bypassGuard,
      destination,
      onBeforeDestinationActivated: options.onBeforeDestinationActivated
    })
  ) {
    return;
  }

  if (destination === "settings" && state.activeDestination !== "settings") {
    state.previousTopLevelDestination =
      state.activeDestination || state.previousTopLevelDestination;
  }

  state.activeDestination = destination;
  const reveal = activationOptions.reveal !== false;

  if (reveal) {
    state.loadingBehindSplash = false;
    hideSplash(elements);
  } else if (!elements.splash.hidden) {
    state.loadingBehindSplash = true;
  }

  resetPageScroll();

  topLevelDestinations.forEach((screenDestination) => {
    const screen = options.screens[screenDestination];

    if (screenDestination === destination) {
      screen.show();
    } else {
      screen.hide();
    }
  });

  updateRailSelection(elements, destination);
  if (reveal) {
    focusDestinationNav(elements, destination);
  }

  options.onDestinationActivated?.(destination);
}

function updateRailSelection(
  elements: ApplicationShellElements,
  destination: TopLevelDestinationId
): void {
  getDestinationButtons(elements).forEach((button) => {
    const isActive = button.getAttribute("data-destination") === destination;

    button.setAttribute("aria-current", isActive ? "page" : "false");
  });
}

function readFocusedDestination(elements: ApplicationShellElements): TopLevelDestinationId | null {
  const activeElement = elements.root.ownerDocument.activeElement as HTMLButtonElement;

  return readDestinationFromTarget(activeElement);
}

function focusDestinationNav(
  elements: ApplicationShellElements,
  destination: TopLevelDestinationId | null
): void {
  const selector = destination ? `[data-destination="${destination}"]` : "[data-destination]";
  const button = elements.rail.querySelector<HTMLButtonElement>(selector);

  if (button) {
    button.focus();
  }
}

function getDestinationButtons(elements: ApplicationShellElements): HTMLButtonElement[] {
  return Array.prototype.slice.call(
    elements.rail.querySelectorAll("[data-destination]")
  ) as HTMLButtonElement[];
}

function readDestinationFromTarget(target: EventTarget | null): TopLevelDestinationId | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const button = target.closest("[data-destination]");
  const destination = button ? button.getAttribute("data-destination") : null;

  if (isTopLevelDestinationId(destination)) {
    return destination;
  }

  return null;
}

function hideSplash(elements: ApplicationShellElements): void {
  elements.splash.hidden = true;
  elements.root.hidden = false;
}

function resetPageScroll(): void {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}
