/**
 * `@meumouse/headpress/next`: Next.js glue (App Router, Next 15+).
 *
 * - `nextCache()` — a plugin that turns the SDK's cache tags into `fetch(…, { next: { tags } })`,
 *   so the Data Cache keys reads by the Headpress tag vocabulary and the webhook can expire them.
 * - `createRevalidateRoute()` — the `/api/revalidate` route handler: verifies the Headpress webhook,
 *   then `revalidateTag()`s and `revalidatePath()`s what changed.
 * - `toNextMetadata()` / `seoMetadata()` — Headpress SEO heads as `Metadata` for `generateMetadata`.
 * - `redirectResponse()` — the Response for a redirect rule matched in `proxy.ts` / middleware.
 * - `xmlResponse()` — sitemap documents.
 */
import type { Metadata } from "next";
import { revalidatePath, revalidateTag } from "next/cache.js";
import { cookies } from "next/headers.js";

import { memoryCartToken, type CartTokenStore } from "../cart-token.js";

import type { ConfigStore } from "../config.js";
import { definePlugin, type HeadpressPlugin } from "../plugin.js";
import { decodeHtmlEntities, type RedirectResolution, type RedirectResolver, type Seo, type SeoHead, type SeoTarget } from "../seo.js";
import {
  createWebhookHandler,
  type DeliveryLog,
  type RevalidationPlan,
  type WebhookDelivery,
} from "../webhooks/index.js";

/* ------------------------------------------------------------------ */
/* Data Cache                                                          */
/* ------------------------------------------------------------------ */

export interface NextCacheOptions {
  /** Default seconds a tagged read stays fresh. Defaults to 300; false keeps it until revalidated. */
  revalidate?: number | false;
}

/** Next.js caps tag length; longer tags are dropped rather than failing the fetch. */
const MAX_TAG_LENGTH = 256;
const MAX_TAGS = 64;

/**
 * Tags public reads for the Next.js Data Cache. Reads that carry a customer token, and every
 * mutation, are left uncached (`no-store`): they are personal.
 *
 * @example createHeadpress({ baseUrl, plugins: [nextCache({ revalidate: 300 })] })
 */
export function nextCache(options: NextCacheOptions = {}): HeadpressPlugin<"nextCache", undefined> {
  return definePlugin({
    name: "nextCache",
    onRequest({ init, options: request }) {
      const target = init as RequestInit & { next?: { tags?: string[]; revalidate?: number | false } };
      const method = (init.method ?? "GET").toUpperCase();
      // A caller who set Next options or a cache mode explicitly wins.
      if (target.next || target.cache) return;
      if (method !== "GET" || init.headers.has("Authorization") || init.headers.has("Cart-Token")) {
        target.cache = "no-store";
        return;
      }
      const tags = (request.cacheTags ?? []).filter((tag) => tag.length > 0 && tag.length <= MAX_TAG_LENGTH).slice(0, MAX_TAGS);
      if (tags.length === 0) return;
      target.next = { tags, revalidate: request.revalidate ?? options.revalidate ?? 300 };
    },
  });
}

/* ------------------------------------------------------------------ */
/* Revalidation route                                                  */
/* ------------------------------------------------------------------ */

export interface RevalidateRouteOptions {
  /** `HEADPRESS_WEBHOOK_SECRET`. Without it every delivery is refused (500). */
  secret: string | undefined;
  /** A client whose in-process config copy should be dropped on `headpress:config`. */
  config?: Pick<ConfigStore, "invalidate">;
  /** A redirect resolver to refresh on `seo:redirects`. */
  redirects?: Pick<RedirectResolver, "invalidate">;
  /**
   * How tags expire: `{ expire: 0 }` (default) right away, or a cache-life profile such as `"max"`
   * for stale-while-revalidate.
   */
  profile?: Parameters<typeof revalidateTag>[1];
  /** Extra work per delivery (purge your own caches). Throw to make Headpress retry. */
  onRevalidate?: (delivery: WebhookDelivery, plan: RevalidationPlan) => void | Promise<void>;
  deliveries?: DeliveryLog;
  toleranceSeconds?: number;
}

/**
 * The webhook route.
 *
 * @example
 * // app/api/revalidate/route.ts
 * export const { POST } = createRevalidateRoute({ secret: process.env.HEADPRESS_WEBHOOK_SECRET });
 */
export function createRevalidateRoute(options: RevalidateRouteOptions): { POST: (request: Request) => Promise<Response> } {
  const profile = options.profile ?? { expire: 0 };
  const handler = createWebhookHandler({
    secret: options.secret ?? "",
    toleranceSeconds: options.toleranceSeconds,
    deliveries: options.deliveries,
    async onDelivery(delivery, plan) {
      for (const tag of plan.tags) revalidateTag(tag, profile);
      for (const path of plan.paths) revalidatePath(path.split(/[?#]/)[0] || "/");
      if (plan.config) options.config?.invalidate();
      if (plan.redirects) options.redirects?.invalidate();
      await options.onRevalidate?.(delivery, plan);
    },
  });
  return { POST: handler };
}

/* ------------------------------------------------------------------ */
/* Metadata                                                            */
/* ------------------------------------------------------------------ */

export interface MetadataOptions {
  /**
   * Adjust the page title, e.g. strip a brand suffix the SEO plugin added when the root layout's
   * `title.template` adds it again. Return null to keep the fallback title.
   */
  transformTitle?: (title: string) => string | null;
}

function text(value: string | null | undefined): string | null {
  const decoded = decodeHtmlEntities((value ?? "").trim());
  return decoded.length > 0 ? decoded : null;
}

function robotsFrom(robots: SeoHead["robots"] | undefined): Metadata["robots"] | null {
  if (!robots || typeof robots !== "object") return null;
  const preview = robots.max_image_preview;
  return {
    index: robots.index !== false,
    follow: robots.follow !== false,
    ...(typeof robots.max_snippet === "number" ? { "max-snippet": robots.max_snippet } : {}),
    ...(preview === "none" || preview === "standard" || preview === "large" ? { "max-image-preview": preview } : {}),
    ...(typeof robots.max_video_preview === "number" ? { "max-video-preview": robots.max_video_preview } : {}),
  };
}

/**
 * A Headpress SEO head as Next.js `Metadata`, over a fallback: what the head provides wins, empty
 * fields keep the fallback (SEO plugins often have no description for products).
 */
export function toNextMetadata(head: SeoHead | null | undefined, fallback: Metadata = {}, options: MetadataOptions = {}): Metadata {
  if (!head) return fallback;

  const rawTitle = text(head.title);
  const title = rawTitle && options.transformTitle ? options.transformTitle(rawTitle) : rawTitle;
  const description = text(head.description);
  const canonical = (head.canonical ?? "").trim() || null;
  const robots = robotsFrom(head.robots);

  const og = head.open_graph ?? ({} as Partial<SeoHead["open_graph"]>);
  const ogTitle = text(og.title);
  const ogDescription = text(og.description);
  const ogUrl = (og.url ?? "").trim() || null;
  const ogImages = (Array.isArray(og.images) ? og.images : [])
    .filter((image) => image && typeof image.url === "string" && image.url)
    .map((image) => ({
      url: image.url,
      ...(image.width ? { width: image.width } : {}),
      ...(image.height ? { height: image.height } : {}),
      ...(image.alt ? { alt: image.alt } : {}),
      ...(image.type ? { type: image.type } : {}),
    }));

  const tw = head.twitter ?? ({} as Partial<SeoHead["twitter"]>);
  const twitterTitle = text(tw.title);
  const twitterDescription = text(tw.description);
  const twitterImage = (tw.image ?? "").trim() || null;

  const merged: Metadata = {
    ...fallback,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
  };

  const languages = Object.fromEntries(
    (Array.isArray(head.alternates) ? head.alternates : [])
      .filter((alternate) => alternate?.hreflang && alternate?.href)
      .map((alternate) => [alternate.hreflang, alternate.href]),
  );
  if (canonical || Object.keys(languages).length > 0) {
    merged.alternates = {
      ...fallback.alternates,
      ...(canonical ? { canonical } : {}),
      ...(Object.keys(languages).length > 0 ? { languages } : {}),
    };
  }

  if (robots) merged.robots = robots;

  if (ogTitle || ogDescription || ogUrl || ogImages.length > 0) {
    merged.openGraph = {
      ...fallback.openGraph,
      ...(ogTitle ? { title: ogTitle } : {}),
      ...(ogDescription ? { description: ogDescription } : {}),
      ...(ogUrl ? { url: ogUrl } : {}),
      ...(ogImages.length > 0 ? { images: ogImages } : {}),
    } as Metadata["openGraph"];
  }

  if (twitterTitle || twitterDescription || twitterImage) {
    merged.twitter = {
      card: "summary_large_image",
      ...fallback.twitter,
      ...(twitterTitle ? { title: twitterTitle } : {}),
      ...(twitterDescription ? { description: twitterDescription } : {}),
      ...(twitterImage ? { images: [twitterImage] } : {}),
    } as Metadata["twitter"];
  }

  return merged;
}

/**
 * `generateMetadata` in one call: the head from Headpress over a fallback. Never throws: Headpress
 * down, SEO module off or nothing published all yield the fallback.
 */
export async function seoMetadata(
  hp: { seo: Pick<Seo, "head"> },
  target: SeoTarget,
  fallback: Metadata = {},
  options: MetadataOptions & { revalidate?: number | false } = {},
): Promise<Metadata> {
  try {
    const response = await hp.seo.head(target, { revalidate: options.revalidate });
    return toNextMetadata(response?.head, fallback, options);
  } catch {
    return fallback;
  }
}

/**
 * The head's JSON-LD documents as strings safe to put inside
 * `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html }} />` (no `</script>`
 * breakout).
 */
export function jsonLdScripts(head: SeoHead | null | undefined): string[] {
  return (head?.json_ld ?? []).map((document) =>
    JSON.stringify(document).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029"),
  );
}

/* ------------------------------------------------------------------ */
/* Responses                                                           */
/* ------------------------------------------------------------------ */

/**
 * The Response for a redirect rule matched in `proxy.ts` / middleware: a redirect, or an empty
 * 410/451. Relative destinations resolve against the request URL.
 *
 * @example
 * const match = await redirects.resolve(request.nextUrl);
 * if (match) return redirectResponse(match, request.url);
 */
export function redirectResponse(resolution: RedirectResolution, requestUrl: string | URL): Response {
  if (resolution.destination === null) return new Response(null, { status: resolution.status });
  const location = new URL(resolution.destination, requestUrl).toString();
  return new Response(null, { status: resolution.status, headers: { Location: location } });
}

/** A sitemap (or any XML) response. */
export function xmlResponse(xml: string, options: { maxAge?: number } = {}): Response {
  const maxAge = options.maxAge ?? 3600;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 24}`,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Request state                                                       */
/* ------------------------------------------------------------------ */

/**
 * The shopper's Cart-Token from the request cookies (`hp_cart` by default, as written by
 * `cookieCartToken()` in the browser), for server components and route handlers. Create the
 * server client per request with it: `createHeadpress({ ..., cartToken: await requestCartToken() })`.
 */
export async function requestCartToken(name = "hp_cart"): Promise<CartTokenStore> {
  const store = await cookies();
  return memoryCartToken(store.get(name)?.value ?? null);
}
