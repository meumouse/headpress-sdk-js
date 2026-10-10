/**
 * `@meumouse/headpress/next/server`: Next.js pieces that only run on the server.
 *
 * - `createRevalidateRoute()` — the `/api/revalidate` route handler: verifies the Headpress webhook,
 *   then `revalidateTag()`s and `revalidatePath()`s what changed.
 * - `createAuthHandler()` — the storefront's auth routes (BFF) for `bffSession()`.
 * - `requestCartToken()` — the shopper's Cart-Token from the request cookies.
 */
import { revalidatePath, revalidateTag } from "next/cache.js";
import { cookies } from "next/headers.js";

import { memoryCartToken, type CartTokenStore } from "../cart-token.js";
import type { ConfigStore } from "../config.js";
import type { RedirectResolver } from "../seo.js";
import {
  createWebhookHandler,
  type DeliveryLog,
  type RevalidationPlan,
  type WebhookDelivery,
} from "../webhooks/index.js";

export { createAuthHandler, type AuthHandlerOptions } from "./auth.js";

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
