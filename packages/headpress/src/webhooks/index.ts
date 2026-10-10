/**
 * `@meumouse/headpress/webhooks`: the revalidation webhook Headpress sends to the storefront.
 *
 * Headpress POSTs a JSON body describing what changed — tags in its cache vocabulary and the
 * storefront paths affected — signed with HMAC-SHA256 over `"<timestamp>.<raw body>"`:
 *
 * ```http
 * X-Headpress-Event: product.updated
 * X-Headpress-Delivery: evt_…
 * X-Headpress-Timestamp: 1790000000
 * X-Headpress-Signature: sha256=<hex>
 *
 * { "id": "evt_…", "event": "product.updated", "events": [...], "tags": [...], "paths": [...], "sent_at": "…" }
 * ```
 *
 * Deliveries are retried up to five times under the same delivery id, so receivers must be
 * idempotent: `createWebhookHandler()` verifies, deduplicates and hands over a revalidation plan.
 * Uses Web Crypto only, so it runs in Node, edge runtimes, Bun and Deno.
 */

export interface WebhookPayload {
  id: string;
  /** The event name, or `batch` when several events were coalesced. */
  event: string;
  events: string[];
  tags: string[];
  paths: string[];
  sent_at: string | null;
}

export interface WebhookDelivery extends WebhookPayload {
  /** `X-Headpress-Delivery`, stable across retries. */
  deliveryId: string;
  /** Signature timestamp, in seconds. */
  timestamp: number;
}

export type WebhookErrorReason =
  | "missing_secret"
  | "missing_signature"
  | "invalid_signature"
  | "expired"
  | "invalid_body";

export class WebhookError extends Error {
  override readonly name = "WebhookError";
  readonly reason: WebhookErrorReason;
  /** HTTP status a receiver should answer with. */
  readonly status: number;

  constructor(reason: WebhookErrorReason, message: string) {
    super(message);
    this.reason = reason;
    this.status = reason === "invalid_body" ? 400 : reason === "missing_secret" ? 500 : 401;
  }
}

/** Seconds a signature stays valid, either way (Headpress `Security\Signature::TOLERANCE`). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison, so the time taken does not reveal how much of a signature matched. */
function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

/** `sha256=<hex>` for a body, as Headpress signs it. For tests and local tooling. */
export async function signWebhook(secret: string, timestamp: number, body: string): Promise<string> {
  return `sha256=${await hmacHex(secret, `${timestamp}.${body}`)}`;
}

export interface VerifyOptions {
  secret: string;
  toleranceSeconds?: number;
  /** Clock in milliseconds, for tests. */
  now?: () => number;
}

/** Throws `WebhookError` unless the signature is valid and fresh. */
export async function verifyWebhookSignature(
  input: { body: string; timestamp: string | null; signature: string | null },
  options: VerifyOptions,
): Promise<number> {
  if (!options.secret) throw new WebhookError("missing_secret", "No webhook secret configured.");
  if (!input.signature || !input.timestamp) {
    throw new WebhookError("missing_signature", "Missing X-Headpress-Signature or X-Headpress-Timestamp.");
  }
  const timestamp = Number(input.timestamp);
  if (!Number.isInteger(timestamp)) throw new WebhookError("invalid_signature", "Invalid timestamp.");

  const now = Math.floor((options.now?.() ?? Date.now()) / 1000);
  if (Math.abs(now - timestamp) > (options.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS)) {
    throw new WebhookError("expired", "The signature is too old (or from the future).");
  }

  const expected = await signWebhook(options.secret, timestamp, input.body);
  if (!timingSafeEqual(expected, input.signature.trim())) {
    throw new WebhookError("invalid_signature", "The signature does not match.");
  }
  return timestamp;
}

function strings(value: unknown, filter: (item: string) => boolean = () => true): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "" && filter(item)) : [];
}

/** Read and verify a delivery from a Fetch API `Request`. Throws `WebhookError`. */
export async function readWebhook(request: Request, options: VerifyOptions): Promise<WebhookDelivery> {
  const body = await request.text();
  const timestamp = await verifyWebhookSignature(
    {
      body,
      timestamp: request.headers.get("X-Headpress-Timestamp"),
      signature: request.headers.get("X-Headpress-Signature"),
    },
    options,
  );

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new WebhookError("invalid_body", "The body is not JSON.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new WebhookError("invalid_body", "The body is not a webhook payload.");
  }
  const record = data as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  const event = typeof record.event === "string" ? record.event : request.headers.get("X-Headpress-Event") ?? "";

  return {
    id,
    event,
    events: strings(record.events),
    tags: strings(record.tags),
    paths: strings(record.paths, (path) => path.startsWith("/")),
    sent_at: typeof record.sent_at === "string" ? record.sent_at : null,
    deliveryId: request.headers.get("X-Headpress-Delivery") ?? id,
    timestamp,
  };
}

/* ------------------------------------------------------------------ */
/* Tags and plans                                                      */
/* ------------------------------------------------------------------ */

/** A Headpress cache tag, parsed. */
export type CacheTag =
  | { kind: "config" }
  | { kind: "post"; postType: string; id: number }
  | { kind: "post_slug"; postType: string; slug: string }
  | { kind: "post_list"; postType: string }
  | { kind: "term"; taxonomy: string; id: number }
  | { kind: "term_slug"; taxonomy: string; slug: string }
  | { kind: "term_list"; taxonomy: string }
  | { kind: "menu"; location: string }
  | { kind: "menu_id"; id: number }
  | { kind: "seo"; name: string }
  | { kind: "reviews"; productId: number }
  | { kind: "order"; id: number }
  | { kind: "feed"; id: string }
  | { kind: "acf"; page: string | null; name: string }
  | { kind: "path"; path: string }
  | { kind: "other"; tag: string };

/** Parse a tag of the Headpress vocabulary (unknown shapes come back as `other`). */
export function parseCacheTag(tag: string): CacheTag {
  let match: RegExpExecArray | null;
  if (tag === "headpress:config") return { kind: "config" };
  if ((match = /^path:(\/.*)$/.exec(tag))) return { kind: "path", path: match[1] as string };
  if ((match = /^term:([^:]+):list$/.exec(tag))) return { kind: "term_list", taxonomy: match[1] as string };
  if ((match = /^term:([^:]+):slug:(.+)$/.exec(tag))) return { kind: "term_slug", taxonomy: match[1] as string, slug: match[2] as string };
  if ((match = /^term:([^:]+):(\d+)$/.exec(tag))) return { kind: "term", taxonomy: match[1] as string, id: Number(match[2]) };
  if ((match = /^menu:id:(\d+)$/.exec(tag))) return { kind: "menu_id", id: Number(match[1]) };
  if ((match = /^menu:(.+)$/.exec(tag))) return { kind: "menu", location: match[1] as string };
  if ((match = /^seo:(.+)$/.exec(tag))) return { kind: "seo", name: match[1] as string };
  if ((match = /^reviews:product:(\d+)$/.exec(tag))) return { kind: "reviews", productId: Number(match[1]) };
  if ((match = /^order:(\d+)$/.exec(tag))) return { kind: "order", id: Number(match[1]) };
  if ((match = /^feed:(.+)$/.exec(tag))) return { kind: "feed", id: match[1] as string };
  if ((match = /^acf:options:(.+)$/.exec(tag))) return { kind: "acf", page: match[1] as string, name: "options" };
  if ((match = /^acf:(.+)$/.exec(tag))) return { kind: "acf", page: null, name: match[1] as string };
  if ((match = /^([a-z0-9_-]+):list$/.exec(tag))) return { kind: "post_list", postType: match[1] as string };
  if ((match = /^([a-z0-9_-]+):slug:(.+)$/.exec(tag))) return { kind: "post_slug", postType: match[1] as string, slug: match[2] as string };
  if ((match = /^([a-z0-9_-]+):(\d+)$/.exec(tag))) return { kind: "post", postType: match[1] as string, id: Number(match[2]) };
  return { kind: "other", tag };
}

export interface RevalidationPlan {
  /** Every tag to expire: the delivery's, `path:<path>` for each path, and the derived ones. */
  tags: string[];
  /** Storefront paths to re-render. */
  paths: string[];
  /** The store config changed (`headpress:config`). */
  config: boolean;
  /** Redirect rules may have changed (`seo:redirects`). */
  redirects: boolean;
}

/**
 * What to expire for a delivery. Fetches made through the SDK are tagged with the same vocabulary
 * (plus `path:<path>` for path-addressed reads such as SEO heads), so the plan is the delivery's
 * tags, a `path:` tag per path, and a few derived tags:
 *
 * - `seo:redirects` (SEO plugin settings changed) also expires every SEO head (`seo:head`);
 * - a product, post or term change also expires `seo:sitemap`.
 */
export function planRevalidation(payload: Pick<WebhookPayload, "tags" | "paths">): RevalidationPlan {
  const tags = new Set(payload.tags);
  const paths = Array.from(new Set(payload.paths.filter((path) => path.startsWith("/"))));
  for (const path of paths) tags.add(`path:${path.replace(/\/+$/, "") || "/"}`);

  if (tags.has("seo:redirects")) tags.add("seo:head");
  for (const tag of payload.tags) {
    const parsed = parseCacheTag(tag);
    if (parsed.kind === "post" || parsed.kind === "post_slug" || parsed.kind === "term" || parsed.kind === "term_slug") {
      tags.add("seo:sitemap");
      break;
    }
  }

  return { tags: Array.from(tags), paths, config: tags.has("headpress:config"), redirects: tags.has("seo:redirects") };
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export interface DeliveryLog {
  has(deliveryId: string): boolean | Promise<boolean>;
  add(deliveryId: string): void | Promise<void>;
}

/** Remembers the last `max` delivery ids in memory (per process). */
export function memoryDeliveryLog(max = 1000): DeliveryLog {
  const seen = new Set<string>();
  return {
    has: (id) => seen.has(id),
    add(id) {
      seen.add(id);
      if (seen.size > max) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
    },
  };
}

export interface WebhookHandlerOptions extends VerifyOptions {
  /** Called once per delivery (retries of a handled delivery are skipped). Throw to make Headpress retry. */
  onDelivery: (delivery: WebhookDelivery, plan: RevalidationPlan) => void | Promise<void>;
  /** Defaults to an in-memory log of 1 000 ids. */
  deliveries?: DeliveryLog;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * A Fetch API handler for the webhook endpoint: `(request) => Response`. Answers 401 for a bad or
 * stale signature, 400 for a bad body, 200 once `onDelivery` succeeded (or for a repeated delivery),
 * and 500 when `onDelivery` throws — Headpress then retries the delivery later.
 */
export function createWebhookHandler(options: WebhookHandlerOptions): (request: Request) => Promise<Response> {
  const deliveries = options.deliveries ?? memoryDeliveryLog();
  return async (request) => {
    if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

    let delivery: WebhookDelivery;
    try {
      delivery = await readWebhook(request, options);
    } catch (error) {
      if (error instanceof WebhookError) return json({ ok: false, error: error.reason }, error.status);
      throw error;
    }

    if (delivery.deliveryId && (await deliveries.has(delivery.deliveryId))) {
      return json({ ok: true, duplicate: true }, 200);
    }

    const plan = planRevalidation(delivery);
    try {
      await options.onDelivery(delivery, plan);
    } catch {
      return json({ ok: false, error: "handler_failed" }, 500);
    }
    if (delivery.deliveryId) await deliveries.add(delivery.deliveryId);
    return json({ ok: true, tags: plan.tags.length, paths: plan.paths.length }, 200);
  };
}
