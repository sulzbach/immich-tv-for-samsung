// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Album,
  AlbumAsset,
  AlbumAssetPage,
  AlbumAssetPageToken,
  SortOrder,
  TimelineBucket
} from "../domain/album";
import { defaultAmbientSettings } from "../domain/ambient";
import { defaultAppSettings, type AppSettings } from "../domain/app-settings";
import type { Memory, Person } from "../domain/home";
import { remoteKeys } from "../platform/tizen/keys";
import { createPassiveViewing } from "../platform/tizen/screensaver";
import { byId, loadAppMarkup, pressKey } from "../test/app-markup";
import { createFakeLifecycle, type FakeLifecycle } from "../test/fake-lifecycle";
import type { AlbumService } from "./album-service";
import { composeApplication, type Application } from "./application";
import type { ConnectionService } from "./connection-service";

// Navigation through the composed application with the real shell and
// screens, driven only by remote keys. Services are fakes.

function asset(id: string, capturedAt: string | null = null): AlbumAsset {
  return {
    capturedAt,
    durationMs: null,
    id,
    livePhotoVideoId: null,
    location: null,
    name: id,
    type: "image"
  };
}

const assets = [asset("a1"), asset("a2"), asset("a3")];
// a1, a2 ... then f2 onwards, so a page repeats the rail's first items.
function moreAssets(from: number, to: number): AlbumAsset[] {
  return Array.from({ length: to - from }, (_, index) =>
    from + index < 2 ? assets[from + index]! : asset(`f${from + index}`)
  );
}
const albums: Album[] = [
  { assetCount: 2, id: "album-1", name: "Holiday", thumbnailAssetId: null },
  { assetCount: 2, id: "album-2", name: "Garden", thumbnailAssetId: null }
];
const person: Person = { id: "person-1", isFavorite: false, name: "Alex" };
const memorySummary: Memory = {
  assetCount: 2,
  assets: [assets[0]!],
  id: "memory-1",
  kind: "on-this-day",
  memoryAt: "2020-10-15T00:00:00.000Z",
  personName: null,
  year: 2020
};
const bucket: TimelineBucket = { assetCount: 2, timeBucket: "2026-10-01T00:00:00.000Z" };
const settings = { apiKey: "test-api-key", serverUrl: "https://immich.example" };

let application: Application | null = null;
let lifecycle: FakeLifecycle;
// The TV screensaver states the app has sent: 0 off, 1 on.
let setScreenSaver: ReturnType<typeof vi.fn<(state: number) => void>>;

function createServices(
  options: {
    connected?: boolean;
    loadSettings?: () => never;
    overrides?: Partial<AlbumService>;
  } = {}
) {
  const page = (items: AlbumAsset[]) =>
    Promise.resolve({ assets: items, nextPageToken: null, total: items.length });
  const albumService = {
    loadAlbumAssetsPage: vi.fn(() => page(assets.slice(0, 2))),
    loadAssetFaces: vi.fn(async () => []),
    loadAlbumDetail: vi.fn(async (id: string) => ({
      ...albums.find((album) => album.id === id)!,
      order: "newest-first" as const
    })),
    loadAlbums: vi.fn(async () => albums),
    loadAssetPlaybackUrl: vi.fn(() => null),
    loadAssetPreviewUrl: vi.fn(async () => null),
    loadAssetThumbnailUrl: vi.fn(async () => null),
    loadAssetViewerStillUrl: vi.fn(async () => null),
    loadFavoriteAssets: vi.fn(() => page(assets.slice(0, 2))),
    // The full collection repeats the rail's items, then continues.
    loadFavoriteAssetsPage: vi.fn(async (_order: SortOrder, token: AlbumAssetPageToken | null) =>
      token?.kind === "page" && token.page === 1
        ? {
            assets: moreAssets(0, 30),
            nextPageToken: { kind: "page" as const, page: 2 },
            total: null
          }
        : { assets: moreAssets(30, 40), nextPageToken: null, total: null }
    ),
    loadMemories: vi.fn(async (_limit: number, pageNumber = 1) =>
      pageNumber === 1 ? [memorySummary] : []
    ),
    // One Memory on the rail and more today, so the rail ends with View all.
    loadMemoriesTotal: vi.fn(async () => 2),
    loadMemory: vi.fn(async () => ({ ...memorySummary, assets: assets.slice(0, 2) })),
    loadPeoplePage: vi.fn(async () => ({ hasMore: false, page: 1, people: [person], total: 1 })),
    loadPersonAssetsPage: vi.fn(() => page(assets.slice(0, 2))),
    loadPersonThumbnailUrl: vi.fn(async () => null),
    loadRecentlyAddedAssets: vi.fn(() => page(assets)),
    loadRecentlyAddedAssetsPage: vi.fn(async () => ({
      assets: moreAssets(0, 3).concat(assets),
      nextPageToken: null,
      total: null
    })),
    loadSettings:
      options.loadSettings || vi.fn(() => (options.connected === false ? null : settings)),
    loadThumbnailUrl: vi.fn(async () => null),
    loadTimelineAssetsPage: vi.fn(() =>
      page([asset("t1", "2026-10-15T10:00:00.000Z"), asset("t2", "2026-10-15T09:00:00.000Z")])
    ),
    loadSearchAssetsPage: vi.fn(() => page(assets.slice(0, 2))),
    loadPlaceSuggestions: vi.fn(async () => ["Exampleland"]),
    loadRandomAssets: vi.fn(async () => assets.slice(0, 2)),
    loadFavoriteBuckets: vi.fn(async () => [bucket]),
    loadFavoriteBucketAssets: vi.fn(async () => assets.slice(0, 2)),
    loadVideoAssets: vi.fn(() => page(assets.slice(0, 2))),
    loadVideoAssetsPage: vi.fn(() => page(assets.slice(0, 2))),
    loadTimelineBuckets: vi.fn(async () => [bucket]),
    loadLivePhotoMotionUrl: vi.fn(async () => null),
    revokeImageUrl: vi.fn(),
    revokeMotionUrl: vi.fn(),
    revokeThumbnailUrl: vi.fn()
  } satisfies AlbumService;

  Object.assign(albumService, options.overrides);
  const connectionService: ConnectionService = {
    load: vi.fn(() => (options.connected === false ? null : settings)),
    save: vi.fn((value) => value),
    test: vi.fn(async () => ({ serverLabel: "Immich", userLabel: "Alex", versionWarning: null }))
  };
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

  return { albumService, connectionService, logger };
}

async function start(
  options: Parameters<typeof createServices>[0] & {
    appSettings?: AppSettings;
    history?: AlbumAsset[];
    // false for a startup that should leave the splash up (a failure).
    waitForReveal?: boolean;
  } = {}
) {
  const services = createServices(options);
  const history = options.history || [];
  const viewingHistory = {
    loadAssets: vi.fn(async (limit: number) => ({
      assets: history.slice(0, limit),
      nextPageToken: null,
      total: history.length
    })),
    record: vi.fn(async () => undefined)
  };

  let storedAppSettings = options.appSettings || defaultAppSettings;

  lifecycle = createFakeLifecycle();
  setScreenSaver = vi.fn<(state: number) => void>();
  application = composeApplication({
    ...services,
    lifecycle,
    passiveViewing: createPassiveViewing({
      logger: services.logger,
      windowRef: { webapis: { appcommon: { setScreenSaver } } }
    }),
    settingsStore: {
      load: () => storedAppSettings,
      save: (value) => (storedAppSettings = value)
    },
    viewingHistory
  });
  application.start();
  // Home opens behind the splash and appears once its rails have loaded;
  // Settings (no connection) appears at once.
  if (options.waitForReveal !== false) {
    await vi.waitFor(() => expect(byId("splash-screen").hidden).toBe(true));
  }

  return { ...services, viewingHistory };
}

const active = () => document.activeElement as HTMLElement | null;
const rail = (destination: string) =>
  document.querySelector<HTMLElement>(`[data-destination="${destination}"]`)!;
const homeTile = () => [
  active()?.getAttribute("data-home-rail"),
  active()?.getAttribute("data-home-index")
];

async function homeLoaded(): Promise<void> {
  await vi.waitFor(() =>
    expect(byId("home-memories-rail").querySelectorAll("button").length).toBe(2)
  );
}

async function focusHomeRail(railId: string, index = 0): Promise<void> {
  await homeLoaded();
  pressKey(remoteKeys.right);
  for (let step = 0; step < 8 && active()?.getAttribute("data-home-rail") !== railId; step += 1) {
    pressKey(remoteKeys.down);
  }
  for (let step = 0; step < index; step += 1) {
    pressKey(remoteKeys.right);
  }
  expect(homeTile()).toEqual([railId, String(index)]);
}

async function collectionGridReady(): Promise<void> {
  await vi.waitFor(() => expect(active()?.getAttribute("data-asset-index")).toBe("0"));
}

beforeEach(() => {
  loadAppMarkup();
  window.scrollTo = vi.fn();
});

afterEach(() => {
  application?.destroy();
  application = null;
});

describe("application routing", () => {
  it("reaches Refresh with Down after the rail has opened Settings", async () => {
    await start();
    await homeLoaded();
    for (let step = 0; step < 4; step += 1) pressKey(remoteKeys.down);
    expect(byId("connection-screen").hidden).toBe(false);
    expect(active()).toBe(rail("settings"));

    pressKey(remoteKeys.down);
    expect(active()).toBe(byId("rail-refresh"));
    expect(byId("connection-screen").hidden).toBe(false);
    pressKey(remoteKeys.up);
    expect(active()).toBe(rail("settings"));
  });

  it("keeps the splash up until every Home rail has loaded, then focuses Home in the rail", async () => {
    let releaseMemories!: () => void;
    await start({
      overrides: {
        loadMemories: vi.fn(
          () =>
            new Promise<[]>((resolve) => {
              releaseMemories = () => resolve([]);
            })
        )
      },
      waitForReveal: false
    });

    await vi.waitFor(() => expect(releaseMemories).toBeTypeOf("function"));
    expect(byId("splash-screen").hidden).toBe(false);
    expect(byId("app-shell").hidden).toBe(true);
    expect(byId("splash-status").textContent).toBe("Loading your library...");

    releaseMemories();
    await vi.waitFor(() => expect(byId("splash-screen").hidden).toBe(true));
    expect(byId("app-shell").hidden).toBe(false);
    expect(active()).toBe(rail("home"));
  });

  it("ignores remote keys behind the splash, then focuses Home in the rail on reveal", async () => {
    let releaseMemories!: () => void;
    await start({
      overrides: {
        loadMemories: vi.fn(
          () =>
            new Promise<[]>((resolve) => {
              releaseMemories = () => resolve([]);
            })
        )
      },
      waitForReveal: false
    });
    await vi.waitFor(() => expect(releaseMemories).toBeTypeOf("function"));

    // Back, then Down and OK (which would open Photos), then Back again
    // (which would open the exit dialog), all while the splash is up.
    for (const key of [remoteKeys.back, remoteKeys.down, remoteKeys.enter, remoteKeys.back]) {
      const event = pressKey(key);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(byId("exit-dialog").hidden).toBe(true);
    expect(byId("splash-screen").hidden).toBe(false);
    expect(byId("home-screen").hidden).toBe(false);

    releaseMemories();
    await vi.waitFor(() => expect(byId("splash-screen").hidden).toBe(true));
    expect(active()).toBe(rail("home"));
    expect(byId("exit-dialog").hidden).toBe(true);
    expect(byId("album-detail-screen").hidden).toBe(true);

    // Keys work normally once Home is showing.
    pressKey(remoteKeys.down);
    expect(active()).toBe(rail("photos"));
  });

  it("shows Home after 10 seconds even if a rail is still loading", async () => {
    vi.useFakeTimers();
    try {
      await start({
        overrides: { loadMemories: vi.fn(() => new Promise<never>(() => undefined)) },
        waitForReveal: false
      });
      await vi.advanceTimersByTimeAsync(9000);
      expect(byId("splash-screen").hidden).toBe(false);

      await vi.advanceTimersByTimeAsync(1000);
      expect(byId("splash-screen").hidden).toBe(true);
      expect(active()).toBe(rail("home"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts on Home with the rail focused, or on Settings without a connection", async () => {
    await start();
    expect(byId("home-screen").hidden).toBe(false);
    expect(active()).toBe(rail("home"));
    expect(rail("home").getAttribute("aria-current")).toBe("page");
    application!.destroy();

    loadAppMarkup();
    await start({ connected: false });
    expect(byId("connection-screen").hidden).toBe(false);
    expect(byId("home-screen").hidden).toBe(true);
    expect(byId("connection-back").hidden).toBe(true);
  });

  it("continues a rail with more items in its summary from See more", async () => {
    await start({
      overrides: {
        // The rail's total counts every favourite.
        loadFavoriteAssets: vi.fn(async () => ({
          assets: assets.slice(0, 2),
          nextPageToken: null,
          total: 40
        }))
      }
    });
    await focusHomeRail("favorites", 2);
    expect(active()?.getAttribute("aria-label")).toBe("See more Favourites");
    pressKey(remoteKeys.enter);

    // A library view opens on its first item from See more.
    expect(byId("album-detail-screen").hidden).toBe(false);
    expect(byId("album-detail-title").textContent).toBe("Favourites");
    expect(active()?.getAttribute("data-asset-index")).toBe("0");
    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.back);
    pressKey(remoteKeys.back);
    await vi.waitFor(() => expect(homeTile()).toEqual(["favorites", "2"]));
  });

  describe("library views", () => {
    // Every rail has more items than it shows, so each ends with See more.
    const moreThanShown = {
      loadFavoriteAssets: vi.fn(async () => ({
        assets: assets.slice(0, 2),
        nextPageToken: null,
        total: 40
      })),
      loadRecentlyAddedAssets: vi.fn(async () => ({
        assets: assets.slice(0, 2),
        nextPageToken: null,
        total: 40
      })),
      loadVideoAssets: vi.fn(async () => ({
        assets: assets.slice(0, 2),
        nextPageToken: { cursor: "more", kind: "cursor" as const },
        total: null
      }))
    };

    it.each([
      ["recently-added", "Recently added", "loadRecentlyAddedAssetsPage"],
      ["favorites", "Favourites", "loadFavoriteAssetsPage"],
      ["videos", "Videos", "loadVideoAssetsPage"]
    ] as const)(
      "Home %s item → view → viewer → Back → Back restores each level",
      async (railId, title, pageLoader) => {
        const { albumService, viewingHistory } = await start({ overrides: moreThanShown });
        await focusHomeRail(railId, 1);
        pressKey(remoteKeys.enter);

        expect(byId("album-detail-title").textContent).toBe(title);
        expect(active()?.getAttribute("data-asset-index")).toBe("1");
        await vi.waitFor(() => expect(albumService[pageLoader]).toHaveBeenCalled());
        pressKey(remoteKeys.enter);
        expect(byId("asset-placeholder").hidden).toBe(false);
        expect(viewingHistory.record).toHaveBeenLastCalledWith(
          expect.objectContaining({ id: "a2" }),
          { id: railId, kind: "library", title }
        );

        pressKey(remoteKeys.back);
        expect(active()?.getAttribute("data-asset-index")).toBe("1");
        pressKey(remoteKeys.back);
        expect(byId("home-screen").hidden).toBe(false);
        await vi.waitFor(() => expect(homeTile()).toEqual([railId, "1"]));
      }
    );

    it.each(["recently-added", "favorites", "videos"] as const)(
      "%s See more opens the view on its first item, and Back returns to See more",
      async (railId) => {
        await start({ overrides: moreThanShown });
        await focusHomeRail(railId, 2);
        expect(active()?.getAttribute("aria-label")).toMatch(/^See more /);
        pressKey(remoteKeys.enter);

        expect(byId("album-detail-screen").hidden).toBe(false);
        expect(active()?.getAttribute("data-asset-index")).toBe("0");
        pressKey(remoteKeys.right);
        pressKey(remoteKeys.enter);
        pressKey(remoteKeys.back);
        pressKey(remoteKeys.back);

        await vi.waitFor(() => expect(homeTile()).toEqual([railId, "2"]));
        expect(active()?.getAttribute("aria-label")).toMatch(/^See more /);
      }
    );
  });

  it("Refresh on the rail reloads everything and starts again on Home, as at launch", async () => {
    const { albumService } = await start();
    await homeLoaded();
    pressKey(remoteKeys.right);
    const launchTile = homeTile();
    pressKey(remoteKeys.left);
    await focusHomeRail("albums", 1);
    pressKey(remoteKeys.enter);
    await collectionGridReady();
    const recentBefore = albumService.loadRecentlyAddedAssets.mock.calls.length;

    byId("rail-refresh").focus();
    pressKey(remoteKeys.enter);

    expect(byId("album-detail-screen").hidden).toBe(true);
    expect(byId("home-screen").hidden).toBe(false);
    expect(active()).toBe(rail("home"));
    await vi.waitFor(() =>
      expect(albumService.loadRecentlyAddedAssets.mock.calls.length).toBeGreaterThan(recentBefore)
    );
    await homeLoaded();
    pressKey(remoteKeys.right);
    expect(homeTile()).toEqual(launchTile);

    // Albums was hidden, so it reloads when next opened.
    const albumsBefore = albumService.loadAlbums.mock.calls.length;
    rail("albums").focus();
    pressKey(remoteKeys.enter);
    await vi.waitFor(() =>
      expect(albumService.loadAlbums.mock.calls.length).toBeGreaterThan(albumsBefore)
    );
  });

  it("Photos has no Back control; Left and Back return to the rail", async () => {
    await start();
    pressKey(remoteKeys.down);
    await vi.waitFor(() =>
      expect(byId("album-assets-grid").querySelectorAll("[data-asset-index]")).toHaveLength(2)
    );
    expect(document.getElementById("album-detail-back")).toBeNull();
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.up);
    // Up from the first row reaches the sort order button.
    expect(active()).toBe(byId("collection-sort-order"));
    pressKey(remoteKeys.down);
    expect(active()?.getAttribute("data-asset-index")).toBe("0");
    pressKey(remoteKeys.back);
    expect(active()).toBe(rail("photos"));
  });

  it("opens the Albums screen from the Albums rail's See more", async () => {
    const manyAlbums = Array.from({ length: 20 }, (_, index) => ({
      assetCount: 1,
      id: `album-${index}`,
      name: `Album ${index}`,
      thumbnailAssetId: null
    }));
    await start({ overrides: { loadAlbums: vi.fn(async () => manyAlbums) } });
    await focusHomeRail("albums", 18);
    expect(active()?.getAttribute("aria-label")).toBe("See more Albums");
    pressKey(remoteKeys.enter);

    expect(byId("albums-screen").hidden).toBe(false);
    expect(rail("albums").getAttribute("aria-current")).toBe("page");
    await vi.waitFor(() => expect(active()?.getAttribute("data-album-index")).toBe("0"));
  });

  it("does not offer See more on a rail that already shows everything", async () => {
    await start();
    await homeLoaded();
    for (const railId of ["recently-added", "favorites", "albums"]) {
      expect(byId(`home-${railId}-rail`).querySelector('[aria-label^="See more"]')).toBeNull();
    }
  });

  it("keeps each Home rail's own selection when moving between rails", async () => {
    await start();
    await focusHomeRail("recently-added", 2);
    pressKey(remoteKeys.down);
    expect(homeTile()).toEqual(["favorites", "0"]);
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.up);
    expect(homeTile()).toEqual(["recently-added", "2"]);
    pressKey(remoteKeys.down);
    expect(homeTile()).toEqual(["favorites", "1"]);
  });

  it("Home → Album → viewer → Back → Back restores the originating album tile", async () => {
    await start();
    await focusHomeRail("albums", 1);
    pressKey(remoteKeys.enter);

    expect(byId("home-screen").hidden).toBe(true);
    expect(byId("album-detail-screen").hidden).toBe(false);
    expect(byId("app-shell").getAttribute("data-rail")).toBe("compact");
    await collectionGridReady();
    expect(byId("album-detail-title").textContent).toBe("Garden");

    pressKey(remoteKeys.enter);
    expect(byId("asset-placeholder").hidden).toBe(false);
    pressKey(remoteKeys.back);
    expect(byId("asset-placeholder").hidden).toBe(true);
    pressKey(remoteKeys.back);

    expect(byId("album-detail-screen").hidden).toBe(true);
    expect(byId("home-screen").hidden).toBe(false);
    await vi.waitFor(() => expect(homeTile()).toEqual(["albums", "1"]));
    // Focus is back on Home's content, so the rail stays collapsed.
    expect(byId("app-shell").getAttribute("data-rail")).toBe("compact");
    pressKey(remoteKeys.left);
    pressKey(remoteKeys.left);
    expect(active()).toBe(rail("home"));
    expect(byId("app-shell").getAttribute("data-rail")).toBe("expanded");
  });

  it("Home → People → viewer → Back → Back restores the person tile", async () => {
    const { albumService, viewingHistory } = await start();
    await focusHomeRail("people");
    pressKey(remoteKeys.enter);

    await collectionGridReady();
    expect(albumService.loadPersonAssetsPage).toHaveBeenCalledWith("person-1", "newest-first", {
      kind: "page",
      page: 1
    });
    expect(byId("album-detail-title").textContent).toBe("Alex");
    pressKey(remoteKeys.enter);
    expect(viewingHistory.record).toHaveBeenLastCalledWith(expect.objectContaining({ id: "a1" }), {
      id: "person-person-1",
      kind: "person",
      title: "Alex"
    });
    pressKey(remoteKeys.back);
    expect(active()?.getAttribute("data-asset-index")).toBe("0");
    pressKey(remoteKeys.back);

    expect(byId("home-screen").hidden).toBe(false);
    await vi.waitFor(() => expect(homeTile()).toEqual(["people", "0"]));
  });

  it("Home See more → People → person → viewer → Back → Back → Back restores each step", async () => {
    const everyone: Person[] = Array.from({ length: 40 }, (_, index) => ({
      id: `person-${index}`,
      isFavorite: false,
      name: `Person ${index}`
    }));
    const loadPeoplePage = vi.fn(async (page: number, size: number) => ({
      hasMore: page * size < everyone.length,
      page,
      people: everyone.slice((page - 1) * size, page * size),
      total: everyone.length
    }));
    const { albumService, viewingHistory } = await start({ overrides: { loadPeoplePage } });
    await focusHomeRail("people", 18);
    expect(active()?.getAttribute("aria-label")).toBe("See more People");
    pressKey(remoteKeys.enter);

    expect(byId("people-screen").hidden).toBe(false);
    expect(byId("home-screen").hidden).toBe(true);
    await vi.waitFor(() => expect(active()?.getAttribute("data-person-id")).toBe("person-0"));
    expect(loadPeoplePage).toHaveBeenLastCalledWith(1, 30);
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.enter);

    await collectionGridReady();
    expect(byId("people-screen").hidden).toBe(true);
    expect(albumService.loadPersonAssetsPage).toHaveBeenCalledWith("person-1", "newest-first", {
      kind: "page",
      page: 1
    });
    expect(byId("album-detail-title").textContent).toBe("Person 1");
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.enter);
    expect(byId("asset-placeholder").hidden).toBe(false);
    expect(viewingHistory.record).toHaveBeenLastCalledWith(expect.objectContaining({ id: "a2" }), {
      id: "person-person-1",
      kind: "person",
      title: "Person 1"
    });

    pressKey(remoteKeys.back);
    expect(byId("asset-placeholder").hidden).toBe(true);
    expect(active()?.getAttribute("data-asset-index")).toBe("1");
    pressKey(remoteKeys.back);

    expect(byId("people-screen").hidden).toBe(false);
    expect(byId("album-detail-screen").hidden).toBe(true);
    expect(active()?.getAttribute("data-person-id")).toBe("person-1");
    pressKey(remoteKeys.back);

    expect(byId("people-screen").hidden).toBe(true);
    await vi.waitFor(() => expect(homeTile()).toEqual(["people", "18"]));
  });

  it.each([
    ["recently-added", "Recently Added"],
    ["favorites", "Favourites"]
  ])(
    "Home → %s opens its summary on the chosen item, then the viewer, then Back to the tile",
    async (railId) => {
      await start();
      await focusHomeRail(railId);
      pressKey(remoteKeys.right);
      pressKey(remoteKeys.enter);

      expect(byId("album-detail-screen").hidden).toBe(false);
      expect(byId("asset-placeholder").hidden).toBe(true);
      expect(active()?.getAttribute("data-asset-index")).toBe("1");

      pressKey(remoteKeys.enter);
      expect(byId("asset-placeholder").hidden).toBe(false);
      pressKey(remoteKeys.back);
      expect(byId("asset-placeholder").hidden).toBe(true);
      expect(active()?.getAttribute("data-asset-index")).toBe("1");
      pressKey(remoteKeys.back);

      expect(byId("home-screen").hidden).toBe(false);
      await vi.waitFor(() => expect(homeTile()).toEqual([railId, "1"]));
    }
  );

  it("lazy loads a Home collection beyond its rail without repeating rail items", async () => {
    const { albumService } = await start();
    await focusHomeRail("favorites");
    pressKey(remoteKeys.enter);

    // The rail held 2 items; page 1 repeats them and adds 28 more.
    await vi.waitFor(() =>
      expect(byId("album-detail-summary").getAttribute("data-loaded-count")).toBe("30")
    );
    expect(albumService.loadFavoriteAssetsPage).toHaveBeenCalledWith("newest-first", {
      kind: "page",
      page: 1
    });

    for (let step = 0; step < 3; step += 1) pressKey(remoteKeys.down);
    await vi.waitFor(() =>
      expect(byId("album-detail-summary").getAttribute("data-loaded-count")).toBe("40")
    );
    expect(albumService.loadFavoriteAssetsPage).toHaveBeenLastCalledWith("newest-first", {
      kind: "page",
      page: 2
    });

    pressKey(remoteKeys.enter);
    for (let step = 0; step < 30; step += 1) pressKey(remoteKeys.right);
    expect(byId("asset-placeholder-summary").textContent).toContain("40");
  });

  it("opens Recently Viewed on the chosen item with its whole bounded history", async () => {
    const history = Array.from({ length: 30 }, (_, index) => asset(`h${index}`));
    const { viewingHistory } = await start({ history });
    await focusHomeRail("recently-viewed", 2);
    pressKey(remoteKeys.enter);

    expect(active()?.getAttribute("data-asset-id")).toBe("h2");
    await vi.waitFor(() =>
      expect(byId("album-detail-summary").getAttribute("data-loaded-count")).toBe("30")
    );
    expect(viewingHistory.loadAssets).toHaveBeenLastCalledWith(50);
  });

  it("Home → Memory preview → viewer → Back → Back restores the Memory tile", async () => {
    const { albumService } = await start();
    await focusHomeRail("memories");
    pressKey(remoteKeys.enter);

    await collectionGridReady();
    expect(albumService.loadMemory).toHaveBeenCalledWith("memory-1");
    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.back);
    pressKey(remoteKeys.back);

    expect(byId("memories-screen").hidden).toBe(true);
    await vi.waitFor(() => expect(homeTile()).toEqual(["memories", "0"]));
  });

  it("Home → View all Memories → Memory → Back → Back restores the card, then the View all tile", async () => {
    await start();
    await focusHomeRail("memories", 1);
    pressKey(remoteKeys.enter);

    expect(byId("memories-screen").hidden).toBe(false);
    expect(byId("home-screen").hidden).toBe(true);
    await vi.waitFor(() =>
      expect(byId("memories-grid").querySelectorAll("[data-memory-index]")).toHaveLength(1)
    );
    pressKey(remoteKeys.down);
    expect(active()?.getAttribute("data-memory-index")).toBe("0");
    pressKey(remoteKeys.enter);

    await collectionGridReady();
    expect(byId("memories-screen").hidden).toBe(true);
    pressKey(remoteKeys.back);

    expect(byId("memories-screen").hidden).toBe(false);
    expect(byId("album-detail-screen").hidden).toBe(true);
    expect(active()?.getAttribute("data-memory-index")).toBe("0");
    pressKey(remoteKeys.back);

    expect(byId("memories-screen").hidden).toBe(true);
    await vi.waitFor(() => expect(homeTile()).toEqual(["memories", "1"]));
  });

  it("hides Memory children when the rail changes destination from inside a Memory", async () => {
    await start();
    await focusHomeRail("memories", 1);
    pressKey(remoteKeys.enter);
    await vi.waitFor(() =>
      expect(byId("memories-grid").querySelectorAll("[data-memory-index]")).toHaveLength(1)
    );
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.enter);
    await collectionGridReady();

    pressKey(remoteKeys.left);
    expect(active()).toBe(rail("home"));
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.down);

    expect(active()).toBe(rail("albums"));
    expect(byId("albums-screen").hidden).toBe(false);
    expect(byId("memories-screen").hidden).toBe(true);
    expect(byId("album-detail-screen").hidden).toBe(true);
    expect(byId("home-screen").hidden).toBe(true);
    expect(byId("app-shell").getAttribute("data-rail")).toBe("expanded");
  });

  it("Albums → Album → Back restores the album tile", async () => {
    await start();
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.down);
    expect(active()).toBe(rail("albums"));
    await vi.waitFor(() =>
      expect(byId("albums-grid").querySelectorAll("[data-album-index]")).toHaveLength(2)
    );

    pressKey(remoteKeys.right);
    pressKey(remoteKeys.right);
    expect(active()?.getAttribute("data-album-index")).toBe("1");
    pressKey(remoteKeys.enter);

    await collectionGridReady();
    pressKey(remoteKeys.back);

    expect(byId("albums-screen").hidden).toBe(false);
    expect(active()).toBe(rail("albums"));
    pressKey(remoteKeys.right);
    expect(active()?.getAttribute("data-album-index")).toBe("1");
  });

  it("collapses the rail whenever focus is in Photos, and expands it back on the rail", async () => {
    await start();
    pressKey(remoteKeys.down);
    expect(active()).toBe(rail("photos"));
    await vi.waitFor(() =>
      expect(byId("album-assets-grid").querySelectorAll("[data-asset-index]")).toHaveLength(2)
    );
    expect(byId("app-shell").getAttribute("data-rail")).toBe("expanded");

    pressKey(remoteKeys.right);
    expect(active()?.getAttribute("data-asset-index")).toBe("0");
    expect(byId("app-shell").getAttribute("data-rail")).toBe("compact");
    pressKey(remoteKeys.enter);
    expect(byId("app-shell").getAttribute("data-rail")).toBe("compact");
    pressKey(remoteKeys.back);
    expect(byId("app-shell").getAttribute("data-rail")).toBe("compact");
    pressKey(remoteKeys.back);
    expect(active()).toBe(rail("photos"));
    expect(byId("app-shell").getAttribute("data-rail")).toBe("expanded");
  });

  async function openSearch(): Promise<void> {
    rail("search").focus();
    pressKey(remoteKeys.enter);
    expect(byId("search-screen").hidden).toBe(false);
    pressKey(remoteKeys.right);
  }

  const searchControl = () => active()?.getAttribute("data-search-control") ?? null;

  it("opens Search from the rail on Add people, and Left returns to the rail", async () => {
    await start();
    await openSearch();

    expect(byId("home-screen").hidden).toBe(true);
    expect(searchControl()).toBe("add-people");
    pressKey(remoteKeys.left);
    expect(active()).toBe(rail("search"));
  });

  it("Search → picker → results → viewer → Back → Back restores each step and keeps the criteria", async () => {
    const { albumService, viewingHistory } = await start();
    await openSearch();
    pressKey(remoteKeys.enter);

    expect(byId("search-people-screen").hidden).toBe(false);
    await vi.waitFor(() => expect(active()?.getAttribute("data-person-id")).toBe("person-1"));
    pressKey(remoteKeys.enter);
    expect(byId("search-people-done").textContent).toBe("Done (1 selected)");
    pressKey(remoteKeys.back);

    expect(byId("search-people-screen").hidden).toBe(true);
    expect(byId("search-screen").hidden).toBe(false);
    // Back from the picker lands on its own row; Show photos is four rows down.
    expect(searchControl()).toBe("add-people");
    expect(byId("search-panel").textContent).toContain("Alex");
    for (let row = 0; row < 4; row += 1) pressKey(remoteKeys.down);
    expect(searchControl()).toBe("show");
    pressKey(remoteKeys.enter);

    await collectionGridReady();
    expect(albumService.loadSearchAssetsPage).toHaveBeenCalledWith(
      {
        albums: [],
        mediaType: "all",
        people: [{ id: "person-1", name: "Alex" }],
        place: null,
        takenFrom: null,
        takenTo: null
      },
      "newest-first",
      { kind: "page", page: 1 }
    );
    expect(byId("album-detail-title").textContent).toBe("Alex");
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.enter);
    expect(byId("asset-placeholder").hidden).toBe(false);
    expect(viewingHistory.record).toHaveBeenLastCalledWith(expect.objectContaining({ id: "a2" }), {
      id: "search",
      kind: "search",
      title: "Alex"
    });

    pressKey(remoteKeys.back);
    expect(active()?.getAttribute("data-asset-index")).toBe("1");
    pressKey(remoteKeys.back);

    expect(byId("album-detail-screen").hidden).toBe(true);
    expect(byId("search-screen").hidden).toBe(false);
    expect(searchControl()).toBe("show");
    expect(byId("search-panel").textContent).toContain("Alex");
  });

  it("Search → place picker and album picker → each returns to its own row with the choice", async () => {
    const { albumService } = await start();
    await openSearch();
    for (let row = 0; row < 2; row += 1) pressKey(remoteKeys.down);
    expect(searchControl()).toBe("choose-place");
    pressKey(remoteKeys.enter);

    expect(byId("search-place-screen").hidden).toBe(false);
    await vi.waitFor(() => expect(active()?.textContent).toBe("Exampleland"));
    pressKey(remoteKeys.enter);
    // Anywhere in Exampleland chooses the whole country.
    await vi.waitFor(() => expect(active()?.textContent).toBe("Anywhere in Exampleland"));
    pressKey(remoteKeys.enter);

    expect(byId("search-place-screen").hidden).toBe(true);
    expect(searchControl()).toBe("place-chip");
    pressKey(remoteKeys.down);
    expect(searchControl()).toBe("add-albums");
    pressKey(remoteKeys.enter);

    expect(byId("search-albums-screen").hidden).toBe(false);
    await vi.waitFor(() => expect(active()?.hasAttribute("data-album-id")).toBe(true));
    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.back);

    expect(byId("search-albums-screen").hidden).toBe(true);
    expect(searchControl()).toBe("add-albums");
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.enter);

    await collectionGridReady();
    expect(albumService.loadSearchAssetsPage).toHaveBeenCalledWith(
      expect.objectContaining({
        albums: [expect.objectContaining({ id: expect.any(String) })],
        place: { city: null, country: "Exampleland", state: null }
      }),
      "newest-first",
      { kind: "page", page: 1 }
    );
  });

  it("explains empty search results, and Back returns to the unchanged criteria", async () => {
    await start({
      overrides: {
        loadSearchAssetsPage: vi.fn(async () => ({ assets: [], nextPageToken: null, total: null }))
      }
    });
    await openSearch();
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.enter);
    // Taken → Place → Albums → Show photos.
    for (let row = 0; row < 3; row += 1) pressKey(remoteKeys.down);
    pressKey(remoteKeys.enter);

    await vi.waitFor(() =>
      expect(byId("album-detail-summary").textContent).toBe(
        "No photos match. Try fewer filters or a wider date range."
      )
    );
    expect(active()).toBe(byId("album-detail-screen"));
    expect(byId("album-detail-screen").querySelector(".screen-back-hint")?.textContent).toContain(
      "Press Back to return"
    );
    pressKey(remoteKeys.back);
    expect(byId("search-screen").hidden).toBe(false);
    expect(searchControl()).toBe("show");
    expect(byId("search-panel").textContent).not.toContain("Any dateTo");
  });

  it("drops a search result that arrives after a newer search started", async () => {
    let finishFirst: (page: AlbumAssetPage) => void = () => undefined;
    const loadSearchAssetsPage = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<AlbumAssetPage>((resolve) => (finishFirst = resolve))
      )
      .mockImplementation(async () => ({
        assets: [asset("new")],
        nextPageToken: null,
        total: null
      }));
    await start({ overrides: { loadSearchAssetsPage } });
    await openSearch();
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.enter);
    // Taken → Place → Albums → Show photos.
    for (let row = 0; row < 3; row += 1) pressKey(remoteKeys.down);
    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.back);
    expect(searchControl()).toBe("show");
    pressKey(remoteKeys.enter);

    await collectionGridReady();
    finishFirst({ assets: [asset("stale")], nextPageToken: null, total: null });
    await Promise.resolve();
    await Promise.resolve();

    expect(active()?.getAttribute("data-asset-id")).toBe("new");
    expect(byId("album-assets-grid").querySelector('[data-asset-id="stale"]')).toBeNull();
  });

  it("forgets Search criteria after connection settings are saved", async () => {
    // Without saved settings the app opens Settings, whose Save always applies.
    await start({ connected: false });
    await openSearch();
    pressKey(remoteKeys.enter);
    await vi.waitFor(() => expect(active()?.getAttribute("data-person-id")).toBe("person-1"));
    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.back);
    expect(byId("search-panel").textContent).toContain("Alex");

    rail("settings").focus();
    pressKey(remoteKeys.enter);
    byId("settings-save").focus();
    pressKey(remoteKeys.enter);
    expect(byId("home-screen").hidden).toBe(false);

    await openSearch();
    expect(searchControl()).toBe("add-people");
    expect(byId("search-panel").textContent).not.toContain("Alex");
  });

  it("guards unsaved Settings on the rail and on root Back, and Back from Settings returns to the previous destination", async () => {
    await start();
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.down);
    pressKey(remoteKeys.down);
    expect(active()).toBe(rail("settings"));
    expect(byId("connection-back").hidden).toBe(false);

    const autoplay = byId<HTMLInputElement>("autoplay-videos");
    autoplay.checked = !autoplay.checked;
    autoplay.dispatchEvent(new Event("change", { bubbles: true }));
    rail("settings").focus();

    pressKey(remoteKeys.up);
    expect(byId("settings-panel-unsaved").hidden).toBe(false);
    expect(byId("connection-screen").hidden).toBe(false);
    expect(rail("settings").getAttribute("aria-current")).toBe("page");

    rail("settings").focus();
    pressKey(remoteKeys.back);
    expect(byId("exit-dialog").hidden).toBe(true);
    expect(byId("settings-panel-unsaved").hidden).toBe(false);

    // Back first closes the open unsaved-changes panel; with the change undone
    // a second Back leaves Settings for the previous destination.
    autoplay.checked = !autoplay.checked;
    byId("settings-section-connection").focus();
    pressKey(remoteKeys.back);
    expect(byId("settings-panel-unsaved").hidden).toBe(true);
    expect(byId("connection-screen").hidden).toBe(false);
    pressKey(remoteKeys.back);
    expect(byId("search-screen").hidden).toBe(false);
    expect(active()).toBe(rail("search"));
  });

  it("asks before exiting on root Back and exits through the lifecycle", async () => {
    await start();
    pressKey(remoteKeys.back);

    expect(byId("exit-dialog").hidden).toBe(false);
    pressKey(remoteKeys.right);
    pressKey(remoteKeys.enter);
    expect(lifecycle.exitCount).toBe(1);
  });

  it("pauses an open slideshow when the TV hides the app", async () => {
    await start();
    await focusHomeRail("recently-added");
    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.enter);
    pressKey(remoteKeys.mediaPlayPause);
    expect(byId("asset-viewer-slideshow").getAttribute("data-slideshow-state")).toBe("playing");

    expect(setScreenSaver.mock.calls.map(([state]) => state)).toEqual([0]);

    lifecycle.setVisibility("hidden");
    expect(byId("asset-viewer-slideshow").getAttribute("data-slideshow-state")).toBe("paused");
    // Nothing is passively playing, so the TV's screensaver may come back.
    expect(setScreenSaver.mock.calls.map(([state]) => state)).toEqual([0, 1]);
    lifecycle.setVisibility("visible");
    expect(byId("asset-viewer-slideshow").getAttribute("data-slideshow-state")).toBe("paused");
    expect(setScreenSaver.mock.calls.map(([state]) => state)).toEqual([0, 1]);
  });

  it("returns Home and refreshes after Settings are saved", async () => {
    const { albumService } = await start({ connected: false });
    byId("settings-save").focus();
    pressKey(remoteKeys.enter);

    expect(byId("home-screen").hidden).toBe(false);
    await vi.waitFor(() => expect(albumService.loadAlbums).toHaveBeenCalled());
  });

  it("switches to high contrast as soon as Settings are saved, and back again", async () => {
    await start({ connected: false });
    const highContrast = byId<HTMLInputElement>("high-contrast");
    const save = () => {
      highContrast.dispatchEvent(new Event("change", { bubbles: true }));
      byId("settings-save").focus();
      pressKey(remoteKeys.enter);
    };

    expect(document.documentElement.hasAttribute("data-contrast")).toBe(false);
    highContrast.checked = true;
    save();
    expect(document.documentElement.getAttribute("data-contrast")).toBe("high");

    rail("settings").focus();
    pressKey(remoteKeys.enter);
    byId<HTMLInputElement>("high-contrast").checked = false;
    save();
    expect(document.documentElement.hasAttribute("data-contrast")).toBe(false);
  });

  it("reports a startup failure on the splash and logs it without credentials", async () => {
    const failure = new Error("Storage unavailable");
    const services = await start({
      loadSettings: () => {
        throw failure;
      },
      waitForReveal: false
    });

    expect(byId("splash-error").textContent).toBe("Storage unavailable");
    expect(services.logger.error).toHaveBeenCalledWith("Immich TV startup failed.", {
      error: failure
    });
  });

  describe("ambient mode", () => {
    const stills = {
      loadAssetViewerStillUrl: vi.fn(async (item: AlbumAsset) => `blob:${item.id}`)
    };

    async function openAmbientSettings(): Promise<void> {
      rail("settings").focus();
      pressKey(remoteKeys.enter);
      byId("settings-section-ambient").focus();
      pressKey(remoteKeys.right);
    }

    it("starts from Settings, and any key returns to Start now without asking to exit", async () => {
      await start({ overrides: stills });
      await openAmbientSettings();
      expect(active()).toBe(byId("ambient-source"));
      byId("ambient-start").focus();
      pressKey(remoteKeys.enter);

      await vi.waitFor(() => expect(byId("ambient-screen").hidden).toBe(false));
      expect(setScreenSaver.mock.calls.map(([state]) => state)).toEqual([0]);
      pressKey(remoteKeys.back);

      expect(byId("ambient-screen").hidden).toBe(true);
      expect(byId("exit-dialog").hidden).toBe(true);
      expect(byId("connection-screen").hidden).toBe(false);
      expect(active()).toBe(byId("ambient-start"));
      expect(setScreenSaver.mock.calls.map(([state]) => state)).toEqual([0, 1]);
    });

    it("uses the Settings form's current choices for Start now", async () => {
      const { albumService } = await start({ overrides: stills });
      await openAmbientSettings();
      // Source: Recent, chosen but not saved.
      pressKey(remoteKeys.enter);
      pressKey(remoteKeys.down);
      pressKey(remoteKeys.down);
      pressKey(remoteKeys.enter);
      expect(byId("ambient-source").textContent).toContain("Recent");
      byId("ambient-start").focus();
      pressKey(remoteKeys.enter);

      await vi.waitFor(() =>
        expect(albumService.loadRandomAssets).toHaveBeenCalledWith(
          expect.objectContaining({ takenFrom: expect.any(Date) }),
          20
        )
      );
      pressKey(remoteKeys.enter);
    });

    it("chooses one album in the album picker and returns to the unsaved Settings", async () => {
      await start({ overrides: stills });
      await openAmbientSettings();
      // Source: Album, which shows the album field.
      pressKey(remoteKeys.enter);
      for (let step = 0; step < 3; step += 1) pressKey(remoteKeys.down);
      pressKey(remoteKeys.enter);
      expect(byId("ambient-album-field").hidden).toBe(false);
      expect(byId("ambient-order-field").hidden).toBe(false);
      byId("ambient-album").focus();
      pressKey(remoteKeys.enter);

      expect(byId("search-albums-screen").hidden).toBe(false);
      expect(byId("search-albums-title").textContent).toBe("Choose an album");
      expect(byId("search-albums-done").hidden).toBe(true);
      await vi.waitFor(() => expect(active()?.hasAttribute("data-album-id")).toBe(true));
      const chosen = active()!.getAttribute("data-album-id");
      pressKey(remoteKeys.enter);

      expect(byId("search-albums-screen").hidden).toBe(true);
      expect(byId("connection-screen").hidden).toBe(false);
      expect(active()).toBe(byId("ambient-album"));
      expect(byId("ambient-album").textContent).not.toBe("Choose an album");
      expect(byId("ambient-source").textContent).toContain("Album");
      expect(chosen).toBeTruthy();
    });

    it("starts by itself after the idle time on Home, but not over the viewer", async () => {
      await start({
        appSettings: {
          ...defaultAppSettings,
          ambient: { ...defaultAmbientSettings, startAfterIdleMinutes: 5 }
        },
        overrides: stills
      });
      await focusHomeRail("recently-added");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      pressKey(remoteKeys.right);
      pressKey(remoteKeys.left);
      const tile = active();

      await vi.advanceTimersByTimeAsync(5 * 60000 - 1);
      expect(byId("ambient-screen").hidden).toBe(true);
      // A quiet start shows once its first picture has decoded (here, after
      // the decode wait, as the test DOM never loads images).
      await vi.advanceTimersByTimeAsync(10000);
      expect(byId("ambient-screen").hidden).toBe(false);
      pressKey(remoteKeys.enter);
      expect(byId("ambient-screen").hidden).toBe(true);
      expect(active()).toBe(tile);
      expect(byId("asset-placeholder").hidden).toBe(true);

      // Over the viewer, it never starts: open the collection, then a photo.
      pressKey(remoteKeys.enter);
      await vi.advanceTimersByTimeAsync(100);
      pressKey(remoteKeys.enter);
      expect(byId("asset-placeholder").hidden).toBe(false);
      await vi.advanceTimersByTimeAsync(20 * 60000);
      expect(byId("ambient-screen").hidden).toBe(true);
      vi.useRealTimers();
    });
  });
});
