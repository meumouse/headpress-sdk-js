/**
 * Errors raised by the SDK.
 *
 * Every failure — an error body from WordPress, a network failure, a timeout, a module the store
 * switched off — surfaces as one `HeadpressError` carrying the Headpress error `code`, the HTTP
 * `status` (0 when no response arrived) and the error `data` (`data.fields` for validation errors,
 * `data.attempts_left` for a wrong OTP…). Branch on `code`, never on `message`: Headpress writes
 * messages in the site language. Turn an error into text for shoppers with `formatError`.
 */

/** Data Headpress attaches to an error (`data` in the WordPress error body). */
export interface BaseErrorData {
  status?: number;
  [key: string]: unknown;
}

/**
 * Typed `data` per error code. Add-ons extend it through declaration merging:
 *
 * ```ts
 * declare module "@meumouse/headpress" {
 *   interface ErrorDataMap { cm_invalid_cpf: { field?: string } }
 * }
 * ```
 */
export interface ErrorDataMap {
  headpress_validation_failed: { fields?: Record<string, string> };
  headpress_rate_limited: { retry_after?: number };
  headpress_otp_invalid: { attempts_left?: number };
  headpress_otp_locked: { retry_after?: number };
  headpress_channel_unavailable: { fallback_channels?: string[] };
  headpress_email_exists: { login_required?: boolean };
  headpress_module_disabled: { module: string };
}

/** The `data` of an error with code `C`. */
export type ErrorData<C extends string> = C extends keyof ErrorDataMap
  ? ErrorDataMap[C] & BaseErrorData
  : BaseErrorData;

/** Codes the SDK raises itself, for situations Headpress never saw. */
export const SdkErrorCode = {
  /** The request never reached WordPress (offline, DNS, CORS, TLS). */
  network: "headpress_network_error",
  /** WordPress did not answer within the timeout. */
  timeout: "headpress_timeout",
  /** The caller aborted the request through its own `AbortSignal`. */
  aborted: "headpress_aborted",
  /** A 2xx response whose body is not the JSON the route promises. */
  invalidResponse: "headpress_invalid_response",
  /** The route belongs to a module the store has not enabled. */
  moduleDisabled: "headpress_module_disabled",
  /** A customer route was called without a session. */
  notAuthenticated: "headpress_not_authenticated",
  /** A server-only call (secret key) was attempted in a browser. */
  serverOnly: "headpress_server_only",
  /** A server-only call was attempted without a secret key configured. */
  secretMissing: "headpress_secret_missing",
  /** `/store/config` answered with something that is not a store config. */
  invalidConfig: "headpress_invalid_config",
} as const;

export type SdkErrorCode = (typeof SdkErrorCode)[keyof typeof SdkErrorCode];

/** Where a failed request was going. The query string is left out: it can carry order keys. */
export interface ErrorRequest {
  method: string;
  path: string;
}

const BRAND = Symbol.for("@meumouse/headpress/error");

export class HeadpressError<C extends string = string> extends Error {
  override readonly name = "HeadpressError";
  readonly code: C;
  /** HTTP status, or 0 when no response arrived. */
  readonly status: number;
  readonly data: ErrorData<C>;
  readonly request: ErrorRequest | undefined;

  constructor(
    code: C,
    message: string,
    status: number,
    data?: ErrorData<C>,
    options: { cause?: unknown; request?: ErrorRequest } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.status = status;
    this.data = (data ?? {}) as ErrorData<C>;
    this.request = options.request;
    // A non-enumerable brand rather than a class field, so `isHeadpressError` recognises errors
    // from another copy of the SDK without the symbol showing up in the public types.
    Object.defineProperty(this, BRAND, { value: true });
  }
}

/**
 * Whether `error` is a `HeadpressError` — optionally with one of the given codes, which narrows
 * `error.data` to that code's shape.
 *
 * Works across copies of the SDK (two versions installed side by side), where `instanceof` fails.
 */
export function isHeadpressError(error: unknown): error is HeadpressError;
export function isHeadpressError<C extends string>(
  error: unknown,
  code: C | readonly C[],
): error is HeadpressError<C>;
export function isHeadpressError(error: unknown, code?: string | readonly string[]): boolean {
  const branded =
    error instanceof HeadpressError ||
    (typeof error === "object" && error !== null && (error as Record<symbol, unknown>)[BRAND] === true);
  if (!branded) return false;
  if (code === undefined) return true;
  const actual = (error as HeadpressError).code;
  return typeof code === "string" ? actual === code : code.includes(actual);
}

const UPSTREAM_CODES = new Set([
  "headpress_upstream_error",
  "headpress_integration_unavailable",
  "headpress_internal_error",
]);

/**
 * Whether the error means "WordPress (or something behind it) did not answer" rather than
 * "WordPress said no". Callers use it to show a degraded page instead of a 404, or a "try again"
 * instead of a validation message. A request the caller aborted is neither.
 */
export function isUpstreamFailure(error: unknown): boolean {
  if (!isHeadpressError(error) || error.code === SdkErrorCode.aborted) return false;
  return error.status === 0 || error.status >= 500 || UPSTREAM_CODES.has(error.code);
}

/** Seconds the server asked the client to wait (`data.retry_after` or `Retry-After`), or null. */
export function retryAfter(error: unknown): number | null {
  if (!isHeadpressError(error)) return null;
  const value = Number(error.data.retry_after);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Seconds from a `Retry-After` header (delta-seconds or an HTTP date), or null. */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a non-OK response into a `HeadpressError`. WordPress errors look like
 * `{ code, message, data: { status, … } }`; anything else (a proxy's HTML error page, an empty
 * body) still becomes a coded error from the status alone.
 */
export async function errorFromResponse(
  response: Response,
  request?: ErrorRequest,
): Promise<HeadpressError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const record = isRecord(body) ? body : {};
  const code =
    typeof record.code === "string" && record.code
      ? record.code
      : response.status >= 500
        ? "headpress_upstream_error"
        : "headpress_unknown_error";
  const message =
    typeof record.message === "string" && record.message
      ? record.message
      : `Request failed with status ${response.status}.`;
  const data: BaseErrorData = isRecord(record.data) ? { ...record.data } : {};

  if (data.retry_after === undefined) {
    const wait = parseRetryAfter(response.headers.get("Retry-After"));
    if (wait !== null) data.retry_after = wait;
  }

  return new HeadpressError(code, message, response.status, data, { request });
}
