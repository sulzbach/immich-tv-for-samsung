import type {
  Album,
  AlbumAsset,
  AlbumAssetPage,
  AlbumAssetPageToken,
  AlbumDetail,
  SortOrder,
  TimelineBucket
} from "../../domain/album";
import type { AmbientRandomQuery } from "../../domain/ambient";
import type { ConnectionSettings, CurrentUser, ServerVersion } from "../../domain/connection";
import type { AssetFace } from "../../domain/face";
import { localMemoryDate, type Memory, type PeoplePage } from "../../domain/home";
import type { SearchCriteria, SearchPlaceLevel, SearchPlaceParent } from "../../domain/search";
import { AppError } from "../../errors/app-error";
import type { Logger } from "../../logging/logger";
import { silentLogger } from "../../logging/logger";
import { buildImmichApiUrl } from "../../utils/url";
import {
  createImmichHttp,
  defaultRequestTimeouts,
  type ImmichHttp,
  type RequestTimeouts
} from "./http";
import {
  buildPlaceSuggestionQuery,
  buildRandomAssetFilter,
  buildSearchCriteriaFilter
} from "./search-filter";
import type {
  AlbumDetailResponseDto,
  AlbumResponseDto,
  AssetFaceResponseDto,
  AssetResponseDto,
  MemoryResponseDto,
  PeopleResponseDto,
  SearchAssetResponseDto,
  TimelineBucketAssetsResponseDto,
  TimelineBucketResponseDto
} from "./dto";
import {
  mapAlbum,
  mapAlbumDetail,
  mapAsset,
  mapMemory,
  mapPerson,
  mapTimelineBucket,
  mapAssetFaces,
  mapTimelineBucketAssets,
  mapPlaceSuggestions,
  toImmichAssetOrder
} from "./mappers";
import {
  isAlbumDetailResponse,
  isAlbumResponseList,
  isAssetFaceResponseList,
  isAssetResponse,
  isAssetResponseList,
  isCurrentUser,
  isMemoryResponseList,
  isPeopleResponse,
  isSearchAssetResponse,
  isServerVersion,
  isSuggestionList,
  isTimelineBucketAssetsResponse,
  isTimelineBucketResponseList
} from "./validators";

type FetchLike = typeof fetch;

export type ImmichClient = {
  getAlbumAssetsPage(
    albumId: string,
    order: SortOrder,
    page: AlbumAssetPageToken | null
  ): Promise<AlbumAssetPage>;
  // The Favourites rail: your own favourites, newest first. Its total is
  // every favourite, so Home can tell whether more exist.
  getFavoriteAssets(limit: number): Promise<AlbumAssetPage>;
  // Every favourite of your own in the given order, a month at a time.
  getFavoriteAssetsPage(
    order: SortOrder,
    page: AlbumAssetPageToken | null
  ): Promise<AlbumAssetPage>;
  // The Videos rail's first page; its next cursor tells Home whether more exist.
  getVideoAssets(limit: number): Promise<AlbumAssetPage>;
  // Every timeline video in the given order, paged by search cursor.
  getVideoAssetsPage(order: SortOrder, page: AlbumAssetPageToken | null): Promise<AlbumAssetPage>;
  getMemories(limit: number, page?: number, date?: string): Promise<Memory[]>;
  getMemory(id: string): Promise<Memory>;
  getMemoriesTotal(date: string): Promise<number>;
  // One page of the People list, as Immich orders it. Hidden people are
  // never requested.
  getPeoplePage(page: number, size: number): Promise<PeoplePage>;
  getPersonAssetsPage(
    personId: string,
    order: SortOrder,
    page: AlbumAssetPageToken | null
  ): Promise<AlbumAssetPage>;
  getPersonThumbnail(personId: string): Promise<Blob>;
  // The faces Immich has detected in an asset, without hidden people.
  getAssetFaces(assetId: string): Promise<AssetFace[]>;
  // Assets matching search criteria in the given order, paged by search cursor.
  searchAssetsPage(
    criteria: SearchCriteria,
    order: SortOrder,
    page: AlbumAssetPageToken | null
  ): Promise<AlbumAssetPage>;
  // The distinct place names at one level within the parent, sorted and
  // bounded (`maxPlaceSuggestions`).
  getPlaceSuggestions(level: SearchPlaceLevel, parent: SearchPlaceParent): Promise<string[]>;
  getHistoryAsset(assetId: string): Promise<AlbumAsset | null>;
  // Ambient mode's sources (ADR 0019): a random draw, and your own
  // favourites one timeline bucket at a time.
  getRandomAssets(query: AmbientRandomQuery, size: number): Promise<AlbumAsset[]>;
  getFavoriteBuckets(): Promise<TimelineBucket[]>;
  getFavoriteBucketAssets(timeBucket: string): Promise<AlbumAsset[]>;
  getRecentlyAddedAssets(limit: number): Promise<AlbumAssetPage>;
  // Recently added assets one upload-date bucket at a time, newest first.
  getRecentlyAddedAssetsPage(page: AlbumAssetPageToken | null): Promise<AlbumAssetPage>;
  // The timeline's buckets and their assets run in the given order; both
  // must use the same order, as bucket indexes refer to the bucket list.
  getTimelineAssetsPage(
    order: SortOrder,
    page: AlbumAssetPageToken | null
  ): Promise<AlbumAssetPage>;
  getTimelineBuckets(order: SortOrder): Promise<TimelineBucket[]>;
  getAlbumDetail(albumId: string): Promise<AlbumDetail>;
  getAlbums(): Promise<Album[]>;
  getAssetThumbnail(assetId: string, size?: AssetThumbnailSize): Promise<Blob>;
  // A short video, such as a Live Photo's motion, downloaded whole.
  getAssetVideoBlob(assetId: string): Promise<Blob>;
  getAssetVideoPlaybackUrl(assetId: string): string;
  getCurrentUser(): Promise<CurrentUser>;
  getServerVersion(): Promise<ServerVersion>;
};

type CreateImmichClientOptions = {
  fetchImpl?: FetchLike;
  logger?: Logger;
  settings: ConnectionSettings;
  timeouts?: Partial<RequestTimeouts>;
};

export function createImmichClient(options: CreateImmichClientOptions): ImmichClient {
  const http = createImmichHttp({
    fetchImpl: options.fetchImpl || fetch.bind(window),
    logger: options.logger || silentLogger,
    settings: options.settings,
    timeouts: { ...defaultRequestTimeouts, ...options.timeouts }
  });

  return {
    async getHistoryAsset(assetId) {
      try {
        const response = await http.json<
          AssetResponseDto & { isTrashed: boolean; visibility: string }
        >({
          auth: true,
          feature: "photos and videos",
          path: `/assets/${encodeURIComponent(assetId)}`,
          validate: (body): body is AssetResponseDto & { isTrashed: boolean; visibility: string } =>
            isAssetResponse(body) &&
            typeof (body as { isTrashed?: unknown }).isTrashed === "boolean" &&
            typeof (body as { visibility?: unknown }).visibility === "string"
        });
        if (
          response.isTrashed ||
          (response.visibility !== "timeline" && response.visibility !== "archive")
        )
          return null;
        const asset = mapAsset(response);
        return asset.type === "image" || asset.type === "video" ? asset : null;
      } catch (error) {
        // Immich answers a deleted asset, or one this key cannot read, with 400
        // "Not found or no asset.read access" (requireAccess), not 404.
        if (
          error instanceof AppError &&
          (error.status === 400 ||
            error.status === 403 ||
            error.status === 404 ||
            error.status === 410)
        )
          return null;
        throw error;
      }
    },
    getAlbumAssetsPage(albumId, order, page) {
      return getAlbumAssetPage({
        http,
        albumId,
        order,
        pageRequest: page
      });
    },
    getFavoriteAssets(limit) {
      return getBucketRailPage({
        feature: "Favourites",
        http,
        limit,
        query: favoritesQuery("newest-first")
      });
    },
    getVideoAssets(limit) {
      return getPagedFilteredAssetPage({
        http,
        body: buildFilteredSearchBody(
          videoAssetFilter(),
          railSearchSize(limit),
          "newest-first",
          null
        ),
        feature: "Videos"
      });
    },
    getVideoAssetsPage(order, page) {
      return getPagedFilteredAssetPage({
        http,
        body: buildFilteredSearchBody(videoAssetFilter(), filteredSearchPageSize, order, page),
        feature: "Videos"
      });
    },
    getFavoriteAssetsPage(order, page) {
      return getBucketFeedPage({ feature: "Favourites", http, page, query: favoritesQuery(order) });
    },
    getMemories(limit, page = 1, date = localMemoryDate()) {
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        !Number.isInteger(page) ||
        page < 1 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date))
      ) {
        return Promise.reject(new AppError("invalid-config", "Invalid Memories page or date."));
      }
      const size = Math.min(18, limit);
      return http
        .json<MemoryResponseDto[]>({
          auth: true,
          feature: "Memories",
          path: `/memories?size=${size}&page=${page}&for=${encodeURIComponent(date)}&isTrashed=false&order=desc`,
          validate: isMemoryResponseList
        })
        .then((memories) => memories.slice(0, size).map((memory) => mapMemory(memory, true)));
    },
    getMemoriesTotal(date) {
      return http
        .json<{ total: number }>({
          auth: true,
          feature: "Memories",
          path: `/memories/statistics?for=${encodeURIComponent(date)}&isTrashed=false`,
          validate: (body): body is { total: number } => {
            if (!body || typeof body !== "object") return false;
            const total = (body as { total?: unknown }).total;
            return typeof total === "number" && Number.isSafeInteger(total) && total >= 0;
          }
        })
        .then((response) => response.total);
    },
    getMemory(id) {
      // Search by ID keeps the same hidden-person and trashed-asset filtering as
      // discovery. The separate detail endpoint does not filter hidden people.
      return http
        .json<MemoryResponseDto[]>({
          auth: true,
          feature: "Memories",
          path: `/memories?id=${encodeURIComponent(id)}&size=1&isTrashed=false&order=desc`,
          validate: isMemoryResponseList
        })
        .then((memories) => {
          const memory = memories.find((item) => item.id === id);
          if (!memory)
            throw new AppError(
              "api",
              "This Memory is no longer available. Go Back to refresh Memories."
            );
          return mapMemory(memory);
        });
    },
    getPeoplePage(page, size) {
      if (
        !Number.isInteger(page) ||
        page < 1 ||
        !Number.isInteger(size) ||
        size < 1 ||
        size > 1000
      ) {
        return Promise.reject(new AppError("invalid-config", "Invalid People page."));
      }

      return http
        .json<PeopleResponseDto>({
          auth: true,
          feature: "People",
          path: `/people?page=${page}&size=${size}&withHidden=false`,
          validate: isPeopleResponse
        })
        .then((response) => ({
          // Older servers omit hasNextPage; the total then bounds the pages.
          hasMore:
            response.hasNextPage !== undefined
              ? response.hasNextPage
              : page * size < response.total,
          page,
          people: response.people.map(mapPerson),
          total: response.total
        }));
    },
    getPersonAssetsPage(personId, order, page) {
      return getPagedFilteredAssetPage({
        http,
        body: buildFilteredSearchBody(
          personAssetFilter(personId),
          filteredSearchPageSize,
          order,
          page
        ),
        feature: "People"
      });
    },
    getAssetFaces(assetId) {
      return http
        .json<AssetFaceResponseDto[]>({
          auth: true,
          feature: "Face tags",
          path: `/faces?id=${encodeURIComponent(assetId)}`,
          validate: isAssetFaceResponseList
        })
        .then(mapAssetFaces);
    },
    getPersonThumbnail(personId) {
      return http.blob({
        accept: "image/*",
        allowOctetStream: true,
        auth: true,
        feature: "People",
        path: `/people/${encodeURIComponent(personId)}/thumbnail`
      });
    },
    async getPlaceSuggestions(level, parent) {
      const values = await http.json<Array<string | null>>({
        auth: true,
        feature: "Places",
        path: `/search/suggestions?${buildPlaceSuggestionQuery(level, parent)}`,
        validate: isSuggestionList
      });

      return mapPlaceSuggestions(values);
    },
    async getRandomAssets(query, size) {
      const assets = await http.json<AssetResponseDto[]>({
        auth: true,
        body: { filter: buildRandomAssetFilter(query), size, withExif: true },
        // An album the key may not read is refused before the draw.
        feature: query.albumId ? "Albums" : "Ambient mode",
        method: "POST",
        path: "/search/random",
        validate: isAssetResponseList
      });

      return assets.map(mapAsset);
    },
    async getFavoriteBuckets() {
      const buckets = await http.json<TimelineBucketResponseDto[]>({
        auth: true,
        feature: "Favourites",
        path: `/timeline/buckets?${favoritesQuery("newest-first")}`,
        validate: isTimelineBucketResponseList
      });

      return buckets.map(mapTimelineBucket).filter((bucket) => bucket.assetCount > 0);
    },
    async getFavoriteBucketAssets(timeBucket) {
      const response = await http.json<TimelineBucketAssetsResponseDto>({
        auth: true,
        feature: "Favourites",
        path: `/timeline/bucket?timeBucket=${encodeURIComponent(timeBucket)}&${favoritesQuery("newest-first")}`,
        validate: isTimelineBucketAssetsResponse
      });

      return mapTimelineBucketAssets(response);
    },
    searchAssetsPage(criteria, order, page) {
      return getPagedFilteredAssetPage({
        http,
        body: buildFilteredSearchBody(
          buildSearchCriteriaFilter(criteria),
          filteredSearchPageSize,
          order,
          page
        ),
        // An album the key may not read is refused before the search runs.
        feature: criteria.albums.length > 0 ? "Albums" : "Search"
      });
    },
    getRecentlyAddedAssets(limit) {
      return getBucketRailPage({
        feature: "Recently Added",
        http,
        limit,
        query: recentlyAddedQuery
      });
    },
    getRecentlyAddedAssetsPage(page) {
      return getBucketFeedPage({
        feature: "Recently Added",
        http,
        page,
        query: recentlyAddedQuery
      });
    },
    getTimelineAssetsPage(order, page) {
      return getTimelineAssetPage({
        http,
        order,
        pageRequest: page
      });
    },
    getTimelineBuckets(order) {
      return getTimelineBuckets({ http, order });
    },
    async getAlbumDetail(albumId) {
      const album = await http.json<AlbumDetailResponseDto>({
        auth: true,
        feature: "Albums",
        path: `/albums/${encodeURIComponent(albumId)}`,
        validate: isAlbumDetailResponse
      });

      return mapAlbumDetail(album);
    },
    async getAlbums() {
      const albums = await http.json<AlbumResponseDto[]>({
        auth: true,
        feature: "Albums",
        path: "/albums",
        validate: isAlbumResponseList
      });

      return albums.map(mapAlbum);
    },
    getAssetThumbnail(assetId, size = "thumbnail") {
      return http.blob({
        accept: "image/*",
        auth: true,
        feature: "photos and videos",
        path: `/assets/${encodeURIComponent(assetId)}/thumbnail?size=${encodeURIComponent(size)}`
      });
    },
    getAssetVideoBlob(assetId) {
      return http.blob({
        accept: "video/*",
        auth: true,
        feature: "photos and videos",
        media: "video",
        path: `/assets/${encodeURIComponent(assetId)}/video/playback`
      });
    },
    getAssetVideoPlaybackUrl(assetId) {
      return buildImmichApiUrl(
        options.settings.serverUrl,
        `/assets/${encodeURIComponent(assetId)}/video/playback?apiKey=${encodeURIComponent(options.settings.apiKey)}`
      );
    },
    getCurrentUser() {
      return http.json<CurrentUser>({
        auth: true,
        feature: "your account details",
        path: "/users/me",
        validate: isCurrentUser
      });
    },
    getServerVersion() {
      return http.json<ServerVersion>({
        auth: false,
        path: "/server/version",
        validate: isServerVersion
      });
    }
  };
}

type AssetThumbnailSize = "preview" | "thumbnail";

type AlbumAssetSearchOptions = {
  http: ImmichHttp;
  albumId: string;
  order: SortOrder;
  pageRequest: AlbumAssetPageToken | null;
};

type TimelineAssetSearchOptions = {
  http: ImmichHttp;
  order: SortOrder;
  pageRequest: AlbumAssetPageToken | null;
};

type FilteredAssetSearchOptions = {
  http: ImmichHttp;
  body: Record<string, unknown>;
  feature: string;
};

const albumAssetSearchPageSize = 120;
const timelineAssetSearchPageSize = 120;
const filteredSearchPageSize = 120;

async function getAlbumAssetPage(options: AlbumAssetSearchOptions): Promise<AlbumAssetPage> {
  const response: SearchAssetResponseDto = await options.http.json<SearchAssetResponseDto>({
    auth: true,
    feature: "Albums",
    body: buildAlbumAssetSearchBody(options.albumId, options.order, options.pageRequest),
    method: "POST",
    path: "/search/metadata",
    validate: isSearchAssetResponse
  });

  return {
    assets: response.assets.items.map(mapAsset),
    nextPageToken: readNextSearchCursor(response),
    // A search page's `total` is its own size (deprecated since Immich
    // v3.0.0); the album's asset count is the collection total.
    total: null
  };
}

async function getPagedFilteredAssetPage(
  options: FilteredAssetSearchOptions
): Promise<AlbumAssetPage> {
  const response: SearchAssetResponseDto = await options.http.json<SearchAssetResponseDto>({
    auth: true,
    body: options.body,
    feature: options.feature,
    method: "POST",
    path: "/search/metadata",
    validate: isSearchAssetResponse
  });

  // A search page reports its own size, not the collection's, so no total.
  return {
    assets: response.assets.items.map(mapAsset),
    nextPageToken: readNextSearchCursor(response),
    total: null
  };
}

async function getTimelineAssetPage(options: TimelineAssetSearchOptions): Promise<AlbumAssetPage> {
  if (options.pageRequest?.kind === "bucket") {
    const buckets = await getTimelineBuckets(options);

    return getTimelineBucketPage({
      bucketIndex: options.pageRequest.bucketIndex,
      buckets,
      http: options.http,
      order: options.order
    });
  }

  // Photos pages by timeline bucket; any other request starts a structured
  // search of the timeline in the same order. Bucket counts give the total.
  return getPagedFilteredAssetPage({
    http: options.http,
    body: buildFilteredSearchBody(
      timelineAssetFilter(),
      timelineAssetSearchPageSize,
      options.order,
      options.pageRequest
    ),
    feature: "Photos"
  });
}

async function getTimelineBuckets(
  options: Omit<TimelineAssetSearchOptions, "pageRequest">
): Promise<TimelineBucket[]> {
  const response = await options.http.json<TimelineBucketResponseDto[]>({
    auth: true,
    feature: "Photos",
    path: `/timeline/buckets?${timelineQuery(options.order)}`,
    validate: isTimelineBucketResponseList
  });

  return response.map(mapTimelineBucket);
}

async function getTimelineBucketPage(options: {
  bucketIndex: number;
  buckets: TimelineBucket[];
  http: ImmichHttp;
  order: SortOrder;
}): Promise<AlbumAssetPage> {
  const bucket = options.buckets[options.bucketIndex];

  if (!bucket) {
    return {
      assets: [],
      nextPageToken: null,
      total: readTimelineTotal(options.buckets)
    };
  }

  const response = await options.http.json<TimelineBucketAssetsResponseDto>({
    auth: true,
    feature: "Photos",
    path: `/timeline/bucket?timeBucket=${encodeURIComponent(bucket.timeBucket)}&${timelineQuery(options.order)}`,
    validate: isTimelineBucketAssetsResponse
  });

  return {
    assets: mapTimelineBucketAssets(response),
    nextPageToken:
      options.bucketIndex + 1 < options.buckets.length
        ? {
            bucketIndex: options.bucketIndex + 1,
            kind: "bucket"
          }
        : null,
    total: readTimelineTotal(options.buckets)
  };
}

// Immich sorts the bucket list and the assets within each bucket by this
// order, so reversing it reverses the whole timeline. withPartners delegates
// partner inclusion to Immich's per-partner "Show in timeline" preferences.
function timelineQuery(order: SortOrder): string {
  return `order=${toImmichAssetOrder(order)}&orderBy=takenAt&visibility=timeline&withPartners=true&withStacked=true`;
}

function buildAlbumAssetSearchBody(
  albumId: string,
  order: SortOrder,
  pageRequest: AlbumAssetPageToken | null
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    // Structured search does not exclude trashed assets by itself.
    filter: {
      albumIds: {
        any: [albumId]
      },
      trashedAt: {
        eq: null
      }
    },
    orderBy: {
      direction: toImmichAssetOrder(order),
      field: "fileCreatedAt"
    },
    size: albumAssetSearchPageSize,
    withExif: true
  };

  if (pageRequest?.kind === "cursor") {
    body.cursor = pageRequest.cursor;
  }

  return body;
}

const recentlyAddedQuery =
  "order=desc&orderBy=createdAt&visibility=timeline&isTrashed=false&withPartners=true&withStacked=true";

// Favourites come from the timeline, as in Immich Web, rather than from
// structured search: structured search also covers partners whose "Show in
// timeline" is on, and `isFavorite` is each owner's own flag, so it would
// show a partner's favourites as yours. Without withPartners the timeline
// covers only your own assets (Immich refuses isFavorite with partners).
function favoritesQuery(order: SortOrder): string {
  return `order=${toImmichAssetOrder(order)}&orderBy=takenAt&visibility=timeline&isTrashed=false&isFavorite=true&withStacked=true`;
}

// A timeline-bucket feed (Recently Added, Favourites) pages one month at a
// time. The first page fetches the month list once; each later token names
// its month by timeBucket and carries the months still to come, so a month
// created between pages cannot shift, duplicate or skip a month, and each
// later page costs one request.
async function getBucketFeedPage(options: {
  feature: string;
  http: ImmichHttp;
  page: AlbumAssetPageToken | null;
  query: string;
}): Promise<AlbumAssetPage> {
  let months: string[];

  if (options.page?.kind === "time-bucket") {
    months = [options.page.timeBucket].concat(options.page.later);
  } else {
    months = (
      await options.http.json<TimelineBucketResponseDto[]>({
        auth: true,
        feature: options.feature,
        path: `/timeline/buckets?${options.query}`,
        validate: isTimelineBucketResponseList
      })
    )
      .filter((bucket) => bucket.count > 0)
      .map((bucket) => bucket.timeBucket);
  }

  const month = months[0];

  if (!month) {
    return { assets: [], nextPageToken: null, total: null };
  }

  const response = await options.http.json<TimelineBucketAssetsResponseDto>({
    auth: true,
    feature: options.feature,
    path: `/timeline/bucket?timeBucket=${encodeURIComponent(month)}&${options.query}`,
    validate: isTimelineBucketAssetsResponse
  });
  const later = months.slice(1);

  return {
    assets: mapTimelineBucketAssets(response),
    nextPageToken: later.length
      ? { kind: "time-bucket", later: later.slice(1), timeBucket: later[0]! }
      : null,
    total: null
  };
}

// A Home rail from timeline buckets (Recently Added, by date added, which
// structured search cannot order by; Favourites, your own only): the first
// `limit` assets across months, and the total across every month.
async function getBucketRailPage(options: {
  feature: string;
  http: ImmichHttp;
  limit: number;
  query: string;
}): Promise<AlbumAssetPage> {
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(24, Math.floor(options.limit)))
    : 18;
  const query = options.query;
  const buckets = await options.http.json<TimelineBucketResponseDto[]>({
    auth: true,
    feature: options.feature,
    path: `/timeline/buckets?${query}`,
    validate: isTimelineBucketResponseList
  });
  const assets: AlbumAsset[] = [];

  // Stop at the rail limit even if buckets change while requests are in flight.
  for (const bucket of buckets.filter((bucket) => bucket.count > 0).slice(0, limit)) {
    const response = await options.http.json<TimelineBucketAssetsResponseDto>({
      auth: true,
      feature: options.feature,
      path: `/timeline/bucket?timeBucket=${encodeURIComponent(bucket.timeBucket)}&${query}`,
      validate: isTimelineBucketAssetsResponse
    });
    assets.push(...mapTimelineBucketAssets(response, limit - assets.length));

    if (assets.length >= limit) {
      break;
    }
  }

  return {
    assets,
    nextPageToken: null,
    total: buckets.reduce((total, bucket) => total + bucket.count, 0)
  };
}

function railSearchSize(limit: number): number {
  return Math.max(1, Math.min(24, Math.floor(limit)));
}

function timelineAssetFilter(): Record<string, unknown> {
  return {
    trashedAt: {
      eq: null
    },
    visibility: {
      eq: "timeline"
    }
  };
}

// Live Photo and motion-photo clips are hidden assets, so timeline
// visibility keeps them out of Videos.
function videoAssetFilter(): Record<string, unknown> {
  return {
    trashedAt: {
      eq: null
    },
    type: {
      eq: "VIDEO"
    },
    visibility: {
      eq: "timeline"
    }
  };
}

function personAssetFilter(personId: string): Record<string, unknown> {
  return {
    personIds: {
      any: [personId]
    },
    trashedAt: {
      eq: null
    },
    visibility: {
      eq: "timeline"
    }
  };
}

// By capture date in the given order, in Immich's structured search shape
// (`filter`/`orderBy`/`cursor`, Immich 3.2+). That shape rejects the
// deprecated flat `page` field, so it pages only by the response's
// `nextCursor`; a page token here can only mean the first page, which sends
// no cursor.
function buildFilteredSearchBody(
  filter: Record<string, unknown>,
  size: number,
  order: SortOrder,
  pageRequest: AlbumAssetPageToken | null
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    filter,
    orderBy: {
      direction: toImmichAssetOrder(order),
      field: "fileCreatedAt"
    },
    size,
    withExif: true
  };

  if (pageRequest?.kind === "cursor") {
    body.cursor = pageRequest.cursor;
  }

  return body;
}

// Structured searches page only by `nextCursor`. A flat `nextPage` there
// would read as a first-page request and could refetch the same page forever.
function readNextSearchCursor(response: SearchAssetResponseDto): AlbumAssetPageToken | null {
  const cursor = response.assets.nextCursor;

  if (cursor === undefined || cursor === null) {
    return null;
  }

  const trimmed = String(cursor).trim();

  return trimmed ? { cursor: trimmed, kind: "cursor" } : null;
}

function readTimelineTotal(buckets: TimelineBucket[]): number {
  return buckets.reduce((total, bucket) => total + bucket.assetCount, 0);
}
