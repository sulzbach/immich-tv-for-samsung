import type { ConnectionSettings } from "../../domain/connection";
import { AppError } from "../../errors/app-error";
import type { Logger } from "../../logging/logger";
import { buildImmichApiUrl } from "../../utils/url";

// HTTP transport for the Immich REST API: authentication headers, response
// status mapping, JSON validation and media responses. Endpoint knowledge and
// DTO mapping stay in client.ts.

type FetchLike = typeof fetch;

// Bounded request durations. Chromium 63 has no AbortController (Chrome 66),
// so a stalled request cannot be cancelled; the transport stops waiting and
// rejects with a timeout AppError instead. Callers' generation guards already
// discard any work started for a superseded screen state.
export type RequestTimeouts = {
  // JSON API calls, including reading the full response body.
  jsonMs: number;
  // Thumbnail, preview and person-face images, including the image body.
  mediaMs: number;
};

export const defaultRequestTimeouts: RequestTimeouts = {
  jsonMs: 20000,
  mediaMs: 30000
};

type ImmichHttpContext = {
  fetchImpl: FetchLike;
  logger: Logger;
  settings: ConnectionSettings;
  timeouts: RequestTimeouts;
};

export type JsonRequest<T> = {
  auth: boolean;
  body?: unknown;
  // Household name of the capability this request serves, used when Immich
  // refuses it with HTTP 403 (for example "People").
  feature?: string;
  method?: "GET" | "POST";
  path: string;
  validate(body: unknown): body is T;
};

export type BlobRequest = {
  accept: string;
  allowOctetStream?: boolean;
  // What the response must be: an image (the default) or a video.
  media?: "image" | "video";
  auth: boolean;
  feature?: string;
  path: string;
};

export type ImmichHttp = {
  blob(request: BlobRequest): Promise<Blob>;
  json<T>(request: JsonRequest<T>): Promise<T>;
};

type RequestOptions<T> = ImmichHttpContext & JsonRequest<T>;

type BlobRequestOptions = ImmichHttpContext & BlobRequest;

const previewDebugResponseLimit = 12000;

type PreviewWindow = Window & {
  __immichTvPreviewDebug?: boolean;
};

function withTimeout<T>(
  request: Promise<T>,
  timeoutMs: number,
  path: string,
  logger: Logger
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // A late response after the timeout settles nothing: this promise has
    // already rejected, and the caller never sees the late result.
    const timerId = setTimeout(() => {
      logger.warn("Immich request timed out.", { path, timeoutMs });
      reject(
        new AppError("timeout", "Immich did not respond in time.", {
          cause: `No complete response from ${path} within ${timeoutMs} ms.`
        })
      );
    }, timeoutMs);

    request.then(
      (value) => {
        clearTimeout(timerId);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timerId);
        reject(error);
      }
    );
  });
}

export function createImmichHttp(context: ImmichHttpContext): ImmichHttp {
  return {
    blob(request) {
      return withTimeout(
        requestBlob({ ...context, ...request }),
        context.timeouts.mediaMs,
        request.path,
        context.logger
      );
    },
    json(request) {
      return withTimeout(
        requestJson({ ...context, ...request }),
        context.timeouts.jsonMs,
        request.path,
        context.logger
      );
    }
  };
}

async function requestJson<T>(options: RequestOptions<T>): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json"
  };

  let requestBody: string | undefined;

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(options.body);
  }

  if (options.auth) {
    headers["x-api-key"] = options.settings.apiKey;
  }

  let response: Response;

  try {
    const requestInit: RequestInit = {
      headers,
      method: options.method || "GET"
    };

    if (requestBody !== undefined) {
      requestInit.body = requestBody;
    }

    response = await options.fetchImpl(
      buildImmichApiUrl(options.settings.serverUrl, options.path),
      requestInit
    );
  } catch (error) {
    options.logger.warn("Immich request failed before a response was received.", {
      path: options.path
    });
    throw new AppError("network", "Unable to reach Immich.", { cause: error });
  }

  const body = await readResponseBody(response);

  throwForAccessStatus(response, options.feature);

  if (!response.ok) {
    throw new AppError("api", readApiMessage(response, body), { status: response.status });
  }

  if (body === null) {
    throw new AppError("invalid-response", "Immich returned an empty response.");
  }

  if (!options.validate(body)) {
    options.logger.warn("Immich returned an unexpected response shape.", {
      body: summarizeResponseShape(body),
      path: options.path
    });

    if (isPreviewDebugEnabled()) {
      throw new AppError(
        "invalid-response",
        `Immich response debug:\nEndpoint: ${options.path}\n\n${formatDebugResponseBody(body)}`
      );
    }

    throw new AppError("invalid-response", "Immich returned an unexpected response shape.");
  }

  return body;
}

async function requestBlob(options: BlobRequestOptions): Promise<Blob> {
  const headers: Record<string, string> = {
    Accept: options.accept
  };

  if (options.auth) {
    headers["x-api-key"] = options.settings.apiKey;
  }

  let response: Response;

  try {
    response = await options.fetchImpl(
      buildImmichApiUrl(options.settings.serverUrl, options.path),
      {
        headers,
        method: "GET"
      }
    );
  } catch (error) {
    options.logger.warn("Immich media request failed before a response was received.", {
      path: options.path
    });
    throw new AppError("network", "Unable to reach Immich.", { cause: error });
  }

  throwForAccessStatus(response, options.feature);

  if (!response.ok) {
    throw new AppError("api", `Immich returned HTTP ${response.status}.`, {
      status: response.status
    });
  }

  const media = options.media || "image";

  if (
    !isMediaResponse(response, media) &&
    !(options.allowOctetStream && isOctetStreamResponse(response))
  ) {
    throw new AppError(
      "invalid-response",
      media === "image"
        ? "Immich returned a thumbnail response that was not an image."
        : "Immich returned a playback response that was not a video."
    );
  }

  return response.blob();
}

// 401 means Immich does not accept the key at all. 403 means the key is valid
// but lacks a permission for this capability, which needs a different fix.
function throwForAccessStatus(response: Response, feature: string | undefined): void {
  if (response.status === 401) {
    throw new AppError("auth", "Immich rejected the API key.", { status: response.status });
  }

  if (response.status === 403) {
    throw new AppError("permission", "Immich refused this request for the API key.", {
      feature,
      status: response.status
    });
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (!response.ok) {
      return null;
    }

    throw new AppError("invalid-response", "Immich returned a response that was not valid JSON.");
  }
}

function readApiMessage(response: Response, body: unknown): string {
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message?: unknown }).message;

    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return `Immich returned HTTP ${response.status}.`;
}

function isMediaResponse(response: Response, media: "image" | "video"): boolean {
  const contentType = response.headers.get("content-type");

  return Boolean(contentType && contentType.toLowerCase().indexOf(`${media}/`) === 0);
}

function isOctetStreamResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type");

  return Boolean(contentType && /^application\/octet-stream/i.test(contentType));
}

function isPreviewDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return (window as PreviewWindow).__immichTvPreviewDebug === true;
}

function formatDebugResponseBody(body: unknown): string {
  const json = JSON.stringify(redactDebugValue(body), null, 2) || "undefined";

  if (json.length <= previewDebugResponseLimit) {
    return json;
  }

  return `${json.slice(0, previewDebugResponseLimit)}\n... truncated after ${previewDebugResponseLimit} characters`;
}

function redactDebugValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactDebugValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const output: Record<string, unknown> = {};

  for (const [key, childValue] of Object.entries(value)) {
    if (/api[-_\s]?key|authorization|token|secret|password/i.test(key)) {
      output[key] = "[redacted]";
    } else {
      output[key] = redactDebugValue(childValue);
    }
  }

  return output;
}

function summarizeResponseShape(body: unknown): unknown {
  if (Array.isArray(body)) {
    return {
      firstItem: summarizeResponseShape(body[0]),
      itemCount: body.length,
      type: "array"
    };
  }

  if (!body || typeof body !== "object") {
    return {
      type: typeof body
    };
  }

  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) {
      output[key] = {
        firstItem: summarizeResponseShape(value[0]),
        itemCount: value.length,
        type: "array"
      };
    } else if (value && typeof value === "object") {
      output[key] = {
        keys: Object.keys(value),
        type: "object"
      };
    } else {
      output[key] = typeof value;
    }
  }

  return output;
}
