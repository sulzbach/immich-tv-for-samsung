import type { AmbientOnPowerOn } from "../platform/tizen/ambient-on-power-on";
import type { Album, AlbumAsset, AlbumAssetPage, AlbumAssetPageToken } from "../domain/album";
import type { Memory, Person } from "../domain/home";
import type { SearchAlbum, SearchCriteria, SearchPerson, SearchPlace } from "../domain/search";
import type { Logger } from "../logging/logger";
import type { AppLifecycle } from "../platform/tizen/lifecycle";
import type { PassiveViewing } from "../platform/tizen/screensaver";
import { mountAlbumDetailScreen, type CollectionFeed } from "../screens/album-detail-screen";
import { isLibraryView, type LibraryView } from "../domain/library";
import { formatLibraryViewTitle } from "../presentation/library-labels";
import type { HomeAssetRailId } from "../screens/home/home-model";
import { viewingHistoryLimit } from "../storage/viewing-history-store";
import { mountAlbumsScreen } from "../screens/albums-screen";
import { mountAmbientScreen } from "../screens/ambient/ambient-screen";
import { mountConnectionScreen } from "../screens/connection-screen";
import { mountExitConfirmation } from "../screens/exit-confirmation";
import { mountHomeScreen } from "../screens/home-screen";
import { mountMemoriesScreen } from "../screens/memories-screen";
import { mountPeopleScreen } from "../screens/people-screen";
import { mountAlbumPicker } from "../screens/search/album-picker-screen";
import { mountPeoplePicker } from "../screens/search/people-picker-screen";
import { mountPlacePicker } from "../screens/search/place-picker-screen";
import { mountSearchScreen } from "../screens/search/search-screen";
import type { SupportPage } from "../screens/settings/support-qr";
import { showSplashSupport } from "../screens/splash-support";
import { applyContrastTheme } from "../screens/theme";
import type { AppSettingsStore } from "../storage/app-settings-store";
import { readEffectiveAmbientSettings, readEnabledHomeRails } from "../domain/app-settings";
import type { AlbumService } from "./album-service";
import { createAmbientController } from "./ambient-controller";
import { createAmbientSource } from "./ambient-sources";
import {
  mountApplicationShell,
  type ShellScreenController,
  type TopLevelDestinationId
} from "./app-shell";
import type { ConnectionService } from "./connection-service";
import { createScreenRegistry } from "./screen-registry";
import type { ViewingHistoryService } from "./viewing-history-service";

// Application composition: mounts the shell and every screen over injected
// services and platform abstractions, and owns navigation between them
// (ADR 0007 shell contract, ADR 0012 routing). No router framework: a typed
// route records where the user is and which parent Back returns to.

type AppRoute =
  | { kind: "destination"; destination: TopLevelDestinationId }
  // Ambient mode covers everything; ending it returns to this route.
  | { kind: "ambient"; returnTo: AppRoute | null }
  // Settings → Ambient's single-select album picker.
  | { kind: "ambient-album"; parent: "settings" }
  | { kind: "memories" }
  | { kind: "people" }
  | { kind: "album"; parent: "albums" | "home" }
  | { kind: "home-collection" }
  // A library view; Back restores the rail item it opened from, or See more.
  | { kind: "library"; view: LibraryView; parent: "home"; entry: "item" | "see-more" }
  | { kind: "memory"; parent: "home" | "memories" }
  | { kind: "person"; parent: "home" | "people" }
  | { kind: "search-albums"; parent: "search" }
  | { kind: "search-people"; parent: "search" }
  | { kind: "search-place"; parent: "search" }
  | { kind: "search-results"; parent: "search" };

export type ApplicationDependencies = {
  albumService: AlbumService;
  // Open when the TV turns on: the background service's setting and its
  // requests to start ambient mode (ADR 0024). Absent off the TV.
  ambientOnPowerOn?: AmbientOnPowerOn;
  connectionService: ConnectionService;
  documentRef?: Document;
  lifecycle: AppLifecycle;
  logger: Logger;
  // The TV's own screensaver, held off during passive viewing (ADR 0019).
  passiveViewing: PassiveViewing;
  settingsStore: AppSettingsStore;
  // The tip page for Settings › Support Us and the splash's support line, or
  // null (the default) for a store build (ADR 0021).
  supportPage?: SupportPage | null;
  viewingHistory: ViewingHistoryService;
};

export type Application = {
  destroy(): void;
  // Routes to Home when connection settings exist, otherwise to Settings.
  start(): void;
};

// The longest the splash waits, back in front, for the ambient service to say
// whether the TV is turning on (ADR 0024); it answers at once when running.
const serviceAnswerLimitMs = 3000;
// The longest the splash waits for Home's rails at launch (see
// showHomeBehindSplash).
const homeRevealLimitMs = 10000;

export function composeApplication(dependencies: ApplicationDependencies): Application {
  const { albumService, connectionService, lifecycle, logger, settingsStore, viewingHistory } =
    dependencies;
  const documentRef = dependencies.documentRef || document;
  let destroyed = false;
  let route: AppRoute | null = null;
  // Ambient mode opening as the TV turned on, until it shows (ADR 0024).
  let ambientCover: Promise<void> | null = null;
  // The splash went up as the app went to the background (ADR 0024).
  let coveredWhileHidden = false;
  // Back in front, waiting with the splash up for the service to say whether
  // the TV is turning on (ADR 0024).
  let serviceAnswerTimer: number | null = null;

  const exitConfirmation = mountExitConfirmation({
    documentRef,
    onExit() {
      lifecycle.exit();
    }
  });
  const homeScreen = mountHomeScreen({
    documentRef,
    history: viewingHistory,
    loadEnabledRails: () => readEnabledHomeRails(settingsStore.load()),
    onBrowseAlbums() {
      showAlbums({ refresh: false });
      albumsScreen.focusContent();
    },
    onBrowseMemories() {
      showMemories();
    },
    onBrowsePeople() {
      showPeople();
    },
    onOpenAlbum(album) {
      showAlbumDetail(album, "home");
    },
    onOpenAssetCollection(input) {
      showHomeAssetCollection(input);
    },
    onOpenMemory(memory) {
      showMemory(memory, "home");
    },
    onOpenPerson(person) {
      showPerson(person, "home");
    },
    onOpenSettings() {
      shell.activateDestination("settings");
      connectionScreen.focusSection("home");
    },
    onReturnToShell() {
      shell.focusActiveDestinationNav();
    },
    service: albumService
  });
  const memoriesScreen = mountMemoriesScreen({
    documentRef,
    onBack() {
      showHome({ restoreContentFocus: true });
    },
    onOpenMemory(memory) {
      showMemory(memory, "memories");
    },
    onReturnToShell() {
      shell.focusActiveDestinationNav();
    },
    service: albumService
  });
  const peopleScreen = mountPeopleScreen({
    documentRef,
    onBack() {
      showHome({ restoreContentFocus: true });
    },
    onOpenPerson(person) {
      showPerson(person, "people");
    },
    onReturnToShell() {
      shell.focusActiveDestinationNav();
    },
    service: albumService
  });
  const searchScreen = mountSearchScreen({
    documentRef,
    onAddAlbums(albums) {
      showSearchAlbums(albums);
    },
    onAddPeople(people) {
      showSearchPeople(people);
    },
    onChoosePlace(current) {
      showSearchPlace(current);
    },
    onReturnToShell() {
      shell.focusActiveDestinationNav();
    },
    onShowPhotos(criteria) {
      showSearchResults(criteria);
    },
    service: albumService
  });
  const peoplePicker = mountPeoplePicker({
    documentRef,
    onDone(people) {
      searchScreen.setPeople(people);
      showSearch();
    },
    onReturnToShell() {
      shell.focusActiveDestinationNav();
    },
    service: albumService
  });
  const placePicker = mountPlacePicker({
    documentRef,
    onCancel() {
      searchScreen.setPlace(null);
      showSearch();
    },
    onDone(place) {
      searchScreen.setPlace(place);
      showSearch();
    },
    onReturnToShell() {
      shell.focusActiveDestinationNav();
    },
    service: albumService
  });
  const albumPicker = mountAlbumPicker({
    documentRef,
    onDone(albums) {
      if (route?.kind === "ambient-album") {
        returnToAmbientSettings(albums[0] || null);
        return;
      }

      searchScreen.setAlbums(albums);
      showSearch();
    },
    onReturnToShell() {
      shell.focusActiveDestinationNav();
    },
    service: albumService
  });
  const connectionScreen = mountConnectionScreen({
    documentRef,
    onBack(options) {
      shell.routeBackFromSettings(options);
    },
    onReturnToShell() {
      shell.focusActiveDestinationNav();
    },
    onAppSettingsSaved() {
      const saved = settingsStore.load();

      applyContrastTheme(documentRef, saved.highContrast);
      showSplashSupport(documentRef, Boolean(dependencies.supportPage), saved.supporter);
      ambient.refresh();
      configureAmbientOnPowerOn();
    },
    onChooseAmbientAlbum(album) {
      enterChild({ kind: "ambient-album", parent: "settings" }, "search-albums", albumPicker);
      albumPicker.open(album ? [album] : [], "single");
    },
    onStartAmbient(settings) {
      ambient.startNow(settings);
    },
    onSaved() {
      collectionScreen.forgetSessionSortOrders();
      memoriesScreen.reset();
      peopleScreen.reset();
      searchScreen.reset();
      peoplePicker.reset();
      placePicker.reset();
      albumPicker.reset();
      showHome({ bypassGuard: true });
      homeScreen.refresh();
    },
    service: connectionService,
    settingsStore,
    supportPage: dependencies.supportPage
  });
  const albumsScreen = mountAlbumsScreen({
    documentRef,
    onOpenAlbum(album) {
      showAlbumDetail(album, "albums");
    },
    onReturnToShell() {
      shell.focusActiveDestinationNav();
    },
    service: albumService
  });
  const collectionScreen = mountAlbumDetailScreen({
    documentRef,
    loadFeedPage: (feed, page) => loadFeedPage(feed, page),
    logger,
    onAssetViewed(asset, source) {
      void viewingHistory.record(asset, source);
    },
    onBack(lastViewedAssetId) {
      routeBackFromCollection(lastViewedAssetId);
    },
    onReturnToShell() {
      shell.focusActiveDestinationNav();
    },
    onViewerControlsHiddenChange(hidden) {
      shell.setRailHidden(hidden);
    },
    onViewerOpened() {
      shell.collapseRail();
    },
    passiveViewing: dependencies.passiveViewing,
    service: albumService,
    settingsStore
  });
  const screens = createScreenRegistry({
    albums: albumsScreen,
    collection: collectionScreen,
    home: homeScreen,
    memories: memoriesScreen,
    people: peopleScreen,
    search: searchScreen,
    "search-albums": albumPicker,
    "search-people": peoplePicker,
    "search-place": placePicker,
    settings: connectionScreen
  });

  // The registry hides every other screen whenever a destination shows, so
  // the shell's per-destination hide has nothing left to do.
  function destination(focusContent: () => void, show: () => void): ShellScreenController {
    return { focusContent, hide() {}, show };
  }

  const shell = mountApplicationShell({
    documentRef,
    onRefresh() {
      refreshEverything();
    },
    onBeforeDestinationActivated(fromDestination, toDestination) {
      if (fromDestination === "settings" && toDestination !== "settings") {
        return connectionScreen.requestExit();
      }

      return true;
    },
    onRootBack(activeDestination) {
      // Unsaved Settings stay guarded: the guard panel takes focus instead.
      if (activeDestination === "settings" && !connectionScreen.requestExit()) {
        return;
      }

      exitConfirmation.open();
    },
    screens: {
      albums: destination(
        () => albumsScreen.focusContent(),
        () => {
          enterDestination("albums", "albums", null);
          albumsScreen.show();
        }
      ),
      home: destination(
        () => homeScreen.focusContent(),
        () => {
          enterDestination("home", "home", null);
          homeScreen.show();
        }
      ),
      photos: destination(
        () => collectionScreen.focusContent(),
        () => {
          enterDestination("photos", "collection", collectionScreen);
          shell.hideSplash();
          resetPageScroll();
          collectionScreen.showPhotos();
        }
      ),
      search: destination(
        () => searchScreen.focusContent(),
        () => {
          enterDestination("search", "search", null);
          searchScreen.show();
        }
      ),
      settings: destination(
        () => connectionScreen.focusContent(),
        () => {
          const albumChosen = resumeSettingsWith;

          enterDestination("settings", "settings", null);
          resumeSettingsWith = undefined;

          if (albumChosen !== undefined) {
            connectionScreen.resumeAfterAlbumPicker(albumChosen);
            return;
          }

          connectionScreen.show({ allowBack: albumService.loadSettings() !== null });
        }
      )
    }
  });

  // Set while Settings comes back from the ambient album picker, so it shows
  // as it was left (unsaved choices included) with the album chosen, if any.
  let resumeSettingsWith: { id: string; name: string } | null | undefined;
  const ambientScreen = mountAmbientScreen({
    documentRef,
    onExit() {
      ambient.exit();
    },
    passiveViewing: dependencies.passiveViewing,
    service: albumService
  });
  const ambient = createAmbientController({
    canStartFromIdle,
    createSource: (settings) => createAmbientSource(settings, albumService),
    documentRef,
    lifecycle,
    logger,
    onEnded(focusRestored) {
      route = route?.kind === "ambient" ? route.returnTo : route;

      if (!focusRestored) {
        shell.focusActiveContent();
      }
    },
    onStarted() {
      route = { kind: "ambient", returnTo: route };
    },
    screen: ambientScreen,
    settings: () => readEffectiveAmbientSettings(settingsStore.load())
  });

  // Ambient mode starts by itself only over a browsing screen: never over
  // the splash, Settings, a picker, the exit question, the viewer (slideshow
  // and playback included) or Search while a date or list is open.
  function canStartFromIdle(): boolean {
    const browsing =
      route !== null &&
      (route.kind === "destination"
        ? route.destination !== "settings"
        : [
            "album",
            "home-collection",
            "library",
            "memories",
            "memory",
            "people",
            "person",
            "search-results"
          ].indexOf(route.kind) >= 0);

    return (
      browsing &&
      !shell.isSplashVisible() &&
      !exitConfirmation.isOpen() &&
      !collectionScreen.isViewerOpen() &&
      !searchScreen.isEditing()
    );
  }

  function returnToAmbientSettings(album: { id: string; name: string } | null): void {
    resumeSettingsWith = album;
    shell.activateDestination("settings");
    connectionScreen.focusAmbientAlbum();
  }

  // Gives the background service the saved settings (ADR 0024).
  function configureAmbientOnPowerOn(): void {
    const settings = readEffectiveAmbientSettings(settingsStore.load());

    if (dependencies.ambientOnPowerOn) {
      dependencies.ambientOnPowerOn.configure({
        enabled: settings.openOnPowerOn
      });
    }
  }

  // Opens ambient mode as the TV turned on (ADR 0024). The splash covers the
  // app until ambient mode shows, so the first picture fades in over the
  // splash rather than after a glimpse of the menu. `splashIsCover`: the
  // splash is up only to cover the app, not for loading at launch.
  function startAmbientOverSplash(splashIsCover: boolean): void {
    if (!albumService.loadSettings()) {
      if (splashIsCover) {
        shell.hideSplash();
      }
      return;
    }

    // At launch the splash is already up for Home, which takes it down.
    const launching = shell.isSplashVisible() && !splashIsCover;

    logger.info("Ambient mode requested as the TV turned on.");
    shell.coverWithSplash();
    const cover: Promise<void> = ambient.startIdle({ overSplash: true }).then(() => {
      if (ambientCover === cover) {
        ambientCover = null;
        if (!launching) {
          shell.hideSplash();
        }
      }
    });
    ambientCover = cover;
  }

  // Stops waiting for the service's answer; whether it was being waited for.
  function stopWaitingForService(): boolean {
    if (serviceAnswerTimer === null) {
      return false;
    }

    documentRef.defaultView?.clearTimeout(serviceAnswerTimer);
    serviceAnswerTimer = null;
    return true;
  }

  const stopServiceListening = dependencies.ambientOnPowerOn
    ? dependencies.ambientOnPowerOn.listen((message) => {
        const waited = stopWaitingForService();

        if (message === "ambient") {
          startAmbientOverSplash(waited || coveredWhileHidden);
        } else if (waited && !ambientCover) {
          shell.hideSplash();
        }
      })
    : () => undefined;

  lifecycle.onVisibilityChange((visibility) => {
    if (visibility === "hidden") {
      collectionScreen.suspendPlayback();
      stopWaitingForService();
      // The TV turning on brings the app back for ambient mode: with the
      // splash up now, the screen it left never shows first.
      if (
        readEffectiveAmbientSettings(settingsStore.load()).openOnPowerOn &&
        !ambient.isActive() &&
        !shell.isSplashVisible()
      ) {
        shell.coverWithSplash();
        coveredWhileHidden = true;
      }
      return;
    }

    const covered = coveredWhileHidden;
    const onPowerOn = dependencies.ambientOnPowerOn;

    coveredWhileHidden = false;
    if (onPowerOn && onPowerOn.takeRequest()) {
      startAmbientOverSplash(covered);
    } else if (covered && !ambientCover) {
      // The TV brings the app back by itself as it turns on, before the
      // service has seen it: ask, and keep the splash up for the answer.
      if (onPowerOn && onPowerOn.askIfTurningOn()) {
        serviceAnswerTimer =
          documentRef.defaultView?.setTimeout(() => {
            serviceAnswerTimer = null;
            if (!ambientCover) {
              shell.hideSplash();
            }
          }, serviceAnswerLimitMs) ?? null;
      } else {
        shell.hideSplash();
      }
    }

    // Playback stays paused on return. Keep a visible focus target if the TV
    // dropped focus while the app was in the background.
    if (!documentRef.activeElement || documentRef.activeElement === documentRef.body) {
      shell.focusActiveContent();
    }
  });

  function enterDestination(
    id: TopLevelDestinationId,
    screen: "albums" | "collection" | "home" | "search" | "settings",
    contentFocus: { focusContent(): void } | null
  ): void {
    route = { destination: id, kind: "destination" };
    shell.expandRail();
    shell.setContentFocusController(contentFocus);
    screens.showOnly(screen);
  }

  // Child screens collapse the rail and own content focus.
  function enterChild(
    nextRoute: Exclude<AppRoute, { kind: "destination" }>,
    screen:
      "collection" | "memories" | "people" | "search-albums" | "search-people" | "search-place",
    contentFocus: { focusContent(): void }
  ): void {
    route = nextRoute;
    shell.collapseRail();
    shell.setContentFocusController(contentFocus);
    screens.showOnly(screen);
    resetPageScroll();
  }

  function routeBackFromCollection(lastViewedAssetId?: string): void {
    if (route?.kind === "search-results") {
      showSearch();
      searchScreen.focusShowPhotos();
      return;
    }

    if (route?.kind === "person" && route.parent === "people") {
      showPeople();
      return;
    }

    if (route?.kind === "memory") {
      if (route.parent === "memories") {
        showMemories();
      } else {
        showHome({ restoreContentFocus: true });
      }
      return;
    }

    if (route?.kind === "library") {
      // From See more, Back returns to See more rather than a viewed asset.
      showHome({
        restoreContentFocus: true,
        lastViewedAssetId: route.entry === "item" ? lastViewedAssetId : undefined
      });
      return;
    }

    if (
      route?.kind === "home-collection" ||
      route?.kind === "person" ||
      (route?.kind === "album" && route.parent === "home")
    ) {
      showHome({ restoreContentFocus: true, lastViewedAssetId });
      return;
    }

    if (route?.kind === "album" && route.parent === "albums") {
      showAlbums({ refresh: false });
      return;
    }

    // Top-level collections (Photos) return to the rail themselves.
    shell.focusActiveDestinationNav();
  }

  function showAlbums(options: { bypassGuard?: boolean; refresh: boolean }): void {
    shell.activateDestination("albums", { bypassGuard: options.bypassGuard });

    if (options.refresh) {
      albumsScreen.refresh();
    }
  }

  function showHome(
    options: {
      bypassGuard?: boolean;
      restoreContentFocus?: boolean;
      lastViewedAssetId?: string;
    } = {}
  ): void {
    shell.activateDestination("home", { bypassGuard: options.bypassGuard });

    // Destination activation focuses the shell by default. Returning from a
    // child restores Home's retained rail and tile after that activation finishes.
    if (options.restoreContentFocus) {
      homeScreen.focusContent(options.lastViewedAssetId);
    }
  }

  // The rail's Refresh: reload every screen's data, keeping Search's
  // criteria, and start again on Home as at launch, with focus on Home in
  // the rail. Home loads as it opens; the other screens are hidden by then
  // and load when next shown.
  function refreshEverything(): void {
    homeScreen.reset();
    shell.activateDestination("home");
    memoriesScreen.reset();
    peopleScreen.reset();
    peoplePicker.reset();
    placePicker.reset();
    albumPicker.reset();
    albumsScreen.refresh();
    collectionScreen.refreshPhotos();
  }

  function isHomeRoute(candidate: AppRoute | null): boolean {
    return (
      candidate !== null &&
      ((candidate.kind === "destination" && candidate.destination === "home") ||
        (candidate.kind === "ambient" && isHomeRoute(candidate.returnTo)))
    );
  }

  // At launch, Home loads behind the splash and appears once every rail has
  // loaded or failed, so it opens complete instead of filling in. A server that
  // stalls rather than refusing would keep rails waiting for their request
  // timeouts, so after homeRevealLimitMs Home appears anyway and its last rails
  // finish on screen. It is revealed once, so a late finish can't move focus.
  function showHomeBehindSplash(): void {
    let revealed = false;
    const reveal = () => {
      // Only Home (ambient mode may have opened over it), and only once: by
      // now something else may be showing.
      if (revealed || destroyed || !isHomeRoute(route)) {
        return;
      }

      // Ambient mode opening as the TV turned on is see-through over the
      // splash until its first picture is in: Home must not show through.
      if (ambientCover) {
        void ambientCover.then(reveal);
        return;
      }

      revealed = true;
      documentRef.defaultView?.clearTimeout(limit);
      shell.revealApp();
      homeScreen.relayout();
    };
    const limit = documentRef.defaultView?.setTimeout(reveal, homeRevealLimitMs);

    shell.setSplashStatus("Loading your library...");
    shell.activateDestination("home", { reveal: false });
    void homeScreen.whenLoaded().then(reveal);
  }

  function showSettings(): void {
    shell.expandRail();
    shell.setContentFocusController(null);
    shell.activateDestination("settings");
  }

  function showAlbumDetail(album: Album, parent: "albums" | "home"): void {
    enterChild({ kind: "album", parent }, "collection", collectionScreen);
    shell.hideSplash();
    collectionScreen.show(album, parent);
  }

  function showHomeAssetCollection(input: {
    assets: AlbumAsset[];
    entry: "item" | "see-more";
    index: number;
    rail: HomeAssetRailId;
    title: string;
  }): void {
    const view = isLibraryView(input.rail) ? input.rail : null;

    enterChild(
      view
        ? { entry: input.entry, kind: "library", parent: "home", view }
        : { kind: "home-collection" },
      "collection",
      collectionScreen
    );
    shell.hideSplash();
    collectionScreen.showFeedCollection({
      assets: input.assets,
      feed: readHomeFeed(input.rail, input.entry),
      focusedIndex: input.index,
      id: view || `home-${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      title: view ? formatLibraryViewTitle(view) : input.title
    });
  }

  // A Home rail's collection. Favourites and Videos open in their saved order
  // from See more, but newest first, like the rail, from one of its items.
  function readHomeFeed(rail: HomeAssetRailId, entry: "item" | "see-more"): CollectionFeed {
    if (rail === "favorites" || rail === "videos") {
      return {
        kind: rail,
        order: entry === "see-more" ? settingsStore.load().sortOrders[rail] : "newest-first"
      };
    }

    return { kind: rail };
  }

  // Pages for paged collections. Recently Viewed is the bounded local
  // history, so it has a single page.
  function loadFeedPage(feed: CollectionFeed, page: AlbumAssetPageToken): Promise<AlbumAssetPage> {
    if (feed.kind === "favorites") {
      return albumService.loadFavoriteAssetsPage(feed.order, page);
    }

    if (feed.kind === "recently-added") {
      return albumService.loadRecentlyAddedAssetsPage(page);
    }

    if (feed.kind === "videos") {
      return albumService.loadVideoAssetsPage(feed.order, page);
    }

    if (feed.kind === "person") {
      return albumService.loadPersonAssetsPage(feed.personId, feed.order, page);
    }

    if (feed.kind === "search") {
      return albumService.loadSearchAssetsPage(feed.criteria, feed.order, page);
    }

    return viewingHistory
      .loadAssets(viewingHistoryLimit)
      .then((history) => ({ assets: history.assets, nextPageToken: null, total: null }));
  }

  // Back to the Search destination from one of its children, landing on its
  // remembered control rather than the rail.
  function showSearch(): void {
    shell.activateDestination("search");
    searchScreen.focusContent();
  }

  function showSearchPeople(people: SearchPerson[]): void {
    enterChild({ kind: "search-people", parent: "search" }, "search-people", peoplePicker);
    peoplePicker.open(people);
  }

  function showSearchPlace(current: SearchPlace | null): void {
    enterChild({ kind: "search-place", parent: "search" }, "search-place", placePicker);
    placePicker.open(current);
  }

  function showSearchAlbums(albums: SearchAlbum[]): void {
    enterChild({ kind: "search-albums", parent: "search" }, "search-albums", albumPicker);
    albumPicker.open(albums);
  }

  function showSearchResults(criteria: SearchCriteria): void {
    enterChild({ kind: "search-results", parent: "search" }, "collection", collectionScreen);
    shell.hideSplash();
    collectionScreen.showSearchResults(criteria);
  }

  function showPeople(): void {
    enterChild({ kind: "people" }, "people", peopleScreen);
    peopleScreen.show();
  }

  function showPerson(person: Person, parent: "home" | "people"): void {
    enterChild({ kind: "person", parent }, "collection", collectionScreen);
    shell.hideSplash();
    collectionScreen.showPerson(person, parent);
  }

  function showMemories(): void {
    enterChild({ kind: "memories" }, "memories", memoriesScreen);
    memoriesScreen.show();
  }

  function showMemory(memory: Memory, parent: "home" | "memories"): void {
    enterChild({ kind: "memory", parent }, "collection", collectionScreen);
    shell.hideSplash();
    collectionScreen.showMemory(memory, parent);
  }

  function resetPageScroll(): void {
    window.scrollTo(0, 0);
    documentRef.documentElement.scrollTop = 0;
    documentRef.body.scrollTop = 0;
  }

  return {
    destroy() {
      destroyed = true;
      stopServiceListening();
      stopWaitingForService();
      ambient.destroy();
      ambientScreen.destroy();
      exitConfirmation.destroy();
      shell.destroy();
      homeScreen.destroy();
      memoriesScreen.destroy();
      peopleScreen.destroy();
      searchScreen.destroy();
      peoplePicker.destroy();
      placePicker.destroy();
      albumPicker.destroy();
      connectionScreen.destroy();
      albumsScreen.destroy();
      collectionScreen.destroy();
    },
    start() {
      try {
        if (albumService.loadSettings()) {
          showHomeBehindSplash();
        } else {
          showSettings();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to restore startup state.";

        shell.showSplashError(message);
        logger.error("Immich TV startup failed.", { error });
      }

      logger.info("Immich TV app mounted.", { route });
      configureAmbientOnPowerOn();
      if (dependencies.ambientOnPowerOn && dependencies.ambientOnPowerOn.takeRequest()) {
        startAmbientOverSplash(false);
      }
    }
  };
}
