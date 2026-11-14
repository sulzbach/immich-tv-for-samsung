import { createImmichClient } from "../api/immich/client";
import type { RequestTimeouts } from "../api/immich/http";
import type {
  Album,
  AlbumAsset,
  AlbumAssetPage,
  AlbumAssetPageToken,
  AlbumDetail,
  SortOrder,
  TimelineBucket
} from "../domain/album";
import type { ConnectionSettings } from "../domain/connection";
import type { AssetFace } from "../domain/face";
import type { Memory, PeoplePage, Person } from "../domain/home";
import type { AmbientRandomQuery } from "../domain/ambient";
import type { SearchCriteria, SearchPlaceLevel, SearchPlaceParent } from "../domain/search";
import { isAppError } from "../errors/app-error";
import type { Logger } from "../logging/logger";
import type { ConnectionSettingsStore } from "../storage/connection-settings-store";

type AlbumServiceOptions = {
  fetchImpl?: typeof fetch;
  logger: Logger;
  timeouts?: Partial<RequestTimeouts>;
  store: ConnectionSettingsStore;
  urlFactory?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
};

export type AlbumService = {
  loadAlbumAssetsPage(
    albumId: string,
    order: SortOrder,
    page: AlbumAssetPageToken | null
  ): Promise<AlbumAssetPage>;
  loadTimelineAssetsPage(
    order: SortOrder,
    page: AlbumAssetPageToken | null
  ): Promise<AlbumAssetPage>;
  loadTimelineBuckets(order: SortOrder): Promise<TimelineBucket[]>;
  loadFavoriteAssets(limit: number): Promise<AlbumAssetPage>;
  loadFavoriteAssetsPage(
    order: SortOrder,
    page: AlbumAssetPageToken | null
  ): Promise<AlbumAssetPage>;
  loadVideoAssets(limit: number): Promise<AlbumAssetPage>;
  loadVideoAssetsPage(order: SortOrder, page: AlbumAssetPageToken | null): Promise<AlbumAssetPage>;
  loadMemories(limit: number, page?: number, date?: string): Promise<Memory[]>;
  loadMemory(id: string): Promise<Memory>;
  loadMemoriesTotal(date: string): Promise<number>;
  loadPeoplePage(page: number, size: number): Promise<PeoplePage>;
  loadPersonAssetsPage(
    personId: string,
    order: SortOrder,
    page: AlbumAssetPageToken | null
  ): Promise<AlbumAssetPage>;
  loadPersonThumbnailUrl(person: Pick<Person, "id">): Promise<string | null>;
  loadAssetFaces(assetId: string): Promise<AssetFace[]>;
  loadSearchAssetsPage(
    criteria: SearchCriteria,
    order: SortOrder,
    page: AlbumAssetPageToken | null
  ): Promise<AlbumAssetPage>;
  loadPlaceSuggestions(level: SearchPlaceLevel, parent: SearchPlaceParent): Promise<string[]>;
  loadRandomAssets(query: AmbientRandomQuery, size: number): Promise<AlbumAsset[]>;
  loadFavoriteBuckets(): Promise<TimelineBucket[]>;
  loadFavoriteBucketAssets(timeBucket: string): Promise<AlbumAsset[]>;
  loadRecentlyAddedAssets(limit: number): Promise<AlbumAssetPage>;
  loadRecentlyAddedAssetsPage(page: AlbumAssetPageToken | null): Promise<AlbumAssetPage>;
  loadAlbumDetail(albumId: string): Promise<AlbumDetail>;
  loadAlbums(): Promise<Album[]>;
  loadAssetPlaybackUrl(asset: AlbumAsset): string | null;
  loadAssetPreviewUrl(asset: AlbumAsset): Promise<string | null>;
  loadAssetThumbnailUrl(asset: AlbumAsset): Promise<string | null>;
  loadAssetViewerStillUrl(asset: AlbumAsset): Promise<string | null>;
  // A Live Photo's motion, downloaded whole into an object URL so it plays
  // without waiting on the network; null for anything else, or a motion
  // too large to hold (livePhotoMotionMaxBytes). Revoke it with
  // revokeMotionUrl.
  loadLivePhotoMotionUrl(asset: AlbumAsset): Promise<string | null>;
  loadThumbnailUrl(album: Album): Promise<string | null>;
  loadSettings(): ConnectionSettings | null;
  revokeImageUrl(url: string): void;
  revokeMotionUrl(url: string): void;
  revokeThumbnailUrl(url: string): void;
};

export function createAlbumService(options: AlbumServiceOptions): AlbumService {
  function client() {
    return createImmichClient({
      fetchImpl: options.fetchImpl,
      logger: options.logger,
      settings: requireSettings(options.store.load()),
      timeouts: options.timeouts
    });
  }

  return {
    loadFavoriteAssetsPage(order, page) {
      return client().getFavoriteAssetsPage(order, page);
    },
    loadVideoAssets(limit) {
      return client().getVideoAssets(limit);
    },
    loadVideoAssetsPage(order, page) {
      return client().getVideoAssetsPage(order, page);
    },
    loadPersonAssetsPage(personId, order, page) {
      return client().getPersonAssetsPage(personId, order, page);
    },
    loadRecentlyAddedAssetsPage(page) {
      return client().getRecentlyAddedAssetsPage(page);
    },
    loadAlbumAssetsPage(albumId, order, page) {
      const settings = requireSettings(options.store.load());
      const client = createImmichClient({
        fetchImpl: options.fetchImpl,
        logger: options.logger,
        timeouts: options.timeouts,
        settings
      });

      return client.getAlbumAssetsPage(albumId, order, page);
    },
    loadTimelineAssetsPage(order, page) {
      const settings = requireSettings(options.store.load());
      const client = createImmichClient({
        fetchImpl: options.fetchImpl,
        logger: options.logger,
        timeouts: options.timeouts,
        settings
      });

      return client.getTimelineAssetsPage(order, page);
    },
    loadTimelineBuckets(order) {
      const settings = requireSettings(options.store.load());
      const client = createImmichClient({
        fetchImpl: options.fetchImpl,
        logger: options.logger,
        timeouts: options.timeouts,
        settings
      });

      return client.getTimelineBuckets(order);
    },
    loadFavoriteAssets(limit) {
      const settings = requireSettings(options.store.load());
      const client = createImmichClient({
        fetchImpl: options.fetchImpl,
        logger: options.logger,
        timeouts: options.timeouts,
        settings
      });

      return client.getFavoriteAssets(limit);
    },
    loadMemories(limit, page, date) {
      const settings = requireSettings(options.store.load());
      const client = createImmichClient({
        fetchImpl: options.fetchImpl,
        logger: options.logger,
        timeouts: options.timeouts,
        settings
      });

      return client.getMemories(limit, page, date);
    },
    loadMemoriesTotal(date) {
      return createImmichClient({
        fetchImpl: options.fetchImpl,
        logger: options.logger,
        settings: requireSettings(options.store.load())
      }).getMemoriesTotal(date);
    },
    loadMemory(id) {
      return createImmichClient({
        fetchImpl: options.fetchImpl,
        logger: options.logger,
        settings: requireSettings(options.store.load())
      }).getMemory(id);
    },
    loadAssetFaces(assetId) {
      return client().getAssetFaces(assetId);
    },
    loadPeoplePage(page, size) {
      return client().getPeoplePage(page, size);
    },
    loadSearchAssetsPage(criteria, order, page) {
      return client().searchAssetsPage(criteria, order, page);
    },
    loadPlaceSuggestions(level, parent) {
      return client().getPlaceSuggestions(level, parent);
    },
    loadRandomAssets(query, size) {
      return client().getRandomAssets(query, size);
    },
    loadFavoriteBuckets() {
      return client().getFavoriteBuckets();
    },
    loadFavoriteBucketAssets(timeBucket) {
      return client().getFavoriteBucketAssets(timeBucket);
    },
    async loadPersonThumbnailUrl(person) {
      const settings = requireSettings(options.store.load());
      const client = createImmichClient({
        fetchImpl: options.fetchImpl,
        logger: options.logger,
        timeouts: options.timeouts,
        settings
      });
      const blob = await client.getPersonThumbnail(person.id);

      return (options.urlFactory || URL).createObjectURL(blob);
    },
    loadRecentlyAddedAssets(limit) {
      const settings = requireSettings(options.store.load());
      const client = createImmichClient({
        fetchImpl: options.fetchImpl,
        logger: options.logger,
        timeouts: options.timeouts,
        settings
      });

      return client.getRecentlyAddedAssets(limit);
    },
    loadAlbumDetail(albumId) {
      const settings = requireSettings(options.store.load());
      const client = createImmichClient({
        fetchImpl: options.fetchImpl,
        logger: options.logger,
        timeouts: options.timeouts,
        settings
      });

      return client.getAlbumDetail(albumId);
    },
    loadAlbums() {
      const settings = requireSettings(options.store.load());
      const client = createImmichClient({
        fetchImpl: options.fetchImpl,
        logger: options.logger,
        timeouts: options.timeouts,
        settings
      });

      return client.getAlbums();
    },
    async loadLivePhotoMotionUrl(asset) {
      if (asset.type !== "image" || !asset.livePhotoVideoId) {
        return null;
      }

      const settings = requireSettings(options.store.load());
      const client = createImmichClient({
        fetchImpl: options.fetchImpl,
        logger: options.logger,
        timeouts: options.timeouts,
        settings
      });
      const blob = await client.getAssetVideoBlob(asset.livePhotoVideoId);

      if (blob.size > livePhotoMotionMaxBytes) {
        return null;
      }

      return (options.urlFactory || URL).createObjectURL(blob);
    },
    loadAssetPlaybackUrl(asset) {
      const videoAssetId = readPlaybackVideoAssetId(asset);

      if (!videoAssetId) {
        return null;
      }

      const settings = requireSettings(options.store.load());
      const client = createImmichClient({
        fetchImpl: options.fetchImpl,
        logger: options.logger,
        timeouts: options.timeouts,
        settings
      });

      return client.getAssetVideoPlaybackUrl(videoAssetId);
    },
    async loadAssetPreviewUrl(asset) {
      if (asset.type !== "image") {
        return null;
      }

      const settings = requireSettings(options.store.load());
      const client = createImmichClient({
        fetchImpl: options.fetchImpl,
        logger: options.logger,
        timeouts: options.timeouts,
        settings
      });
      const blob = await client.getAssetThumbnail(asset.id, "preview");

      return (options.urlFactory || URL).createObjectURL(blob);
    },
    async loadAssetThumbnailUrl(asset) {
      const settings = requireSettings(options.store.load());
      const client = createImmichClient({
        fetchImpl: options.fetchImpl,
        logger: options.logger,
        timeouts: options.timeouts,
        settings
      });
      const blob = await loadAssetThumbnailBlob(client, asset);

      return (options.urlFactory || URL).createObjectURL(blob);
    },
    async loadAssetViewerStillUrl(asset) {
      if (asset.type === "image") {
        const settings = requireSettings(options.store.load());
        const client = createImmichClient({
          fetchImpl: options.fetchImpl,
          logger: options.logger,
          timeouts: options.timeouts,
          settings
        });
        const blob = await client.getAssetThumbnail(asset.id, "preview");

        return (options.urlFactory || URL).createObjectURL(blob);
      }

      if (asset.type === "video") {
        const settings = requireSettings(options.store.load());
        const client = createImmichClient({
          fetchImpl: options.fetchImpl,
          logger: options.logger,
          timeouts: options.timeouts,
          settings
        });
        const blob = await loadAssetThumbnailBlob(client, asset);

        return (options.urlFactory || URL).createObjectURL(blob);
      }

      return null;
    },
    async loadThumbnailUrl(album) {
      if (!album.thumbnailAssetId) {
        return null;
      }

      const settings = requireSettings(options.store.load());
      const client = createImmichClient({
        fetchImpl: options.fetchImpl,
        logger: options.logger,
        timeouts: options.timeouts,
        settings
      });
      const blob = await client.getAssetThumbnail(album.thumbnailAssetId);

      return (options.urlFactory || URL).createObjectURL(blob);
    },
    loadSettings() {
      return options.store.load();
    },
    revokeImageUrl(url) {
      (options.urlFactory || URL).revokeObjectURL(url);
    },
    revokeMotionUrl(url) {
      (options.urlFactory || URL).revokeObjectURL(url);
    },
    revokeThumbnailUrl(url) {
      (options.urlFactory || URL).revokeObjectURL(url);
    }
  };
}

// Live Photo motion is a few seconds long, a few megabytes as iPhones record
// it; anything far larger is streamed instead of held in memory.
export const livePhotoMotionMaxBytes = 25 * 1024 * 1024;

function readPlaybackVideoAssetId(asset: AlbumAsset): string | null {
  if (asset.type === "video") {
    return asset.id;
  }

  if (asset.type === "image" && asset.livePhotoVideoId) {
    return asset.livePhotoVideoId;
  }

  return null;
}

async function loadAssetThumbnailBlob(
  client: ReturnType<typeof createImmichClient>,
  asset: AlbumAsset
): Promise<Blob> {
  try {
    return await client.getAssetThumbnail(asset.id);
  } catch (error) {
    if (
      asset.type === "video" &&
      isAppError(error) &&
      error.kind === "api" &&
      error.status === 404
    ) {
      return client.getAssetThumbnail(asset.id, "preview");
    }

    throw error;
  }
}

function requireSettings(settings: ConnectionSettings | null): ConnectionSettings {
  if (!settings) {
    throw new Error("Missing saved Immich connection settings.");
  }

  return settings;
}
