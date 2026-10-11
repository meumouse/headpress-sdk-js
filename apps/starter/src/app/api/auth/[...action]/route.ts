/**
 * The auth BFF for `bffSession()`: sign-in, one-time codes, refresh and logout. The refresh token
 * stays in an httpOnly cookie scoped to this route; the browser only ever holds the access token.
 */
import { createAuthHandler } from "@meumouse.com/headpress/next/server";

import { PUBLISHABLE_KEY, WP_URL } from "@/lib/headpress";

export const { POST } = createAuthHandler({
  baseUrl: WP_URL,
  publishableKey: PUBLISHABLE_KEY,
  // Forwards the shopper's IP so Headpress rate-limits per shopper, not per storefront server.
  secretKey: process.env.HEADPRESS_SECRET_KEY || undefined,
  basePath: "/api/auth",
});
