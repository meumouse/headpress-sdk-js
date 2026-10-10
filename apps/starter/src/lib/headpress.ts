/**
 * The storefront's Headpress client, shared by server components and client components.
 *
 * - In the browser it keeps the customer session through the auth BFF (`bffSession()`, routes in
 *   `app/api/auth/[...action]`) and the cart in the first-party `hp_cart` cookie.
 * - On the server it is a guest client: no session, no Cart-Token (the cookie reader sees no
 *   `document`), so every read it makes is public and `nextCache()` tags it for the Data Cache.
 *   Per-shopper server reads go through `createRequestHeadpress()` in `headpress-server.ts`.
 */
import { bffSession, cookieCartToken, createHeadpress } from "@meumouse/headpress";
import { ptBR } from "@meumouse/headpress/messages/pt-BR";
import { nextCache } from "@meumouse/headpress/next";

/** WordPress site running Headpress, e.g. `https://wp.example.com`. */
export const WP_URL = process.env.NEXT_PUBLIC_WP_URL ?? "";

/** Publishable key (`hp_pk_…`), when the store enforces one. */
export const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_HEADPRESS_PUBLISHABLE_KEY || undefined;

if (!WP_URL) {
  throw new Error("NEXT_PUBLIC_WP_URL is not set. Copy .env.example to .env.local and point it at your Headpress site.");
}

const isBrowser = typeof window !== "undefined";

export const hp = createHeadpress({
  baseUrl: WP_URL,
  publishableKey: PUBLISHABLE_KEY,
  locale: "pt-BR",
  messages: ptBR,
  // The BFF session only exists in the browser; the server never signs anyone in on this client.
  session: isBrowser ? bffSession({ basePath: "/api/auth" }) : undefined,
  cartToken: cookieCartToken(),
  plugins: [nextCache({ revalidate: 300 })],
});

export type StorefrontClient = typeof hp;

/**
 * The storefront's public origin, for sitemaps and robots: `NEXT_PUBLIC_SITE_URL`, else the
 * storefront URL Headpress knows (`config.store.urls.storefront`).
 */
export async function siteUrl(): Promise<string> {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const config = await hp.config.get();
  return (config.store.urls.storefront ?? "").replace(/\/+$/, "");
}
