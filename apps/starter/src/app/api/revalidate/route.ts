/**
 * Headpress's revalidation webhook: verifies the signature, then expires the Data Cache tags and
 * paths that changed. Configure `https://<storefront>/api/revalidate` and the same secret in
 * Headpress (Storefront → Revalidation).
 */
import { createRedirectResolver } from "@meumouse.com/headpress";
import { createRevalidateRoute } from "@meumouse.com/headpress/next/server";

import { hp } from "@/lib/headpress";

export const { POST } = createRevalidateRoute({
  secret: process.env.HEADPRESS_WEBHOOK_SECRET,
  // Drop the in-process config copy on `headpress:config` (route map, modules).
  config: hp.config,
  // The proxy's redirect rules share this cache slot (globalThis), so `seo:redirects` refreshes them.
  redirects: createRedirectResolver(hp.seo),
});
