/**
 * Server-only Headpress helpers.
 *
 * `@meumouse/headpress/server` and `@meumouse/headpress/next/server` resolve to stubs that throw in
 * browser bundles, so importing this file from a client component fails loudly instead of shipping
 * the secret key.
 */
import { cache } from "react";

import type { StoreConfig } from "@meumouse/headpress";
import { ptBR } from "@meumouse/headpress/messages/pt-BR";
import { nextCache } from "@meumouse/headpress/next";
import { requestCartToken } from "@meumouse/headpress/next/server";
import { createServerHeadpress } from "@meumouse/headpress/server";

import { hp, PUBLISHABLE_KEY, WP_URL } from "./headpress";

/**
 * A client for one request, acting for the shopper who made it: their Cart-Token from the `hp_cart`
 * cookie and the secret key (shopper IP forwarding, `server/*` routes). Never share it between
 * requests. Calls carrying the Cart-Token are left out of the Data Cache by `nextCache()`.
 */
export async function createRequestHeadpress() {
  const client = createServerHeadpress({
    baseUrl: WP_URL,
    publishableKey: PUBLISHABLE_KEY,
    secretKey: process.env.HEADPRESS_SECRET_KEY || undefined,
    locale: "pt-BR",
    messages: ptBR,
    cartToken: await requestCartToken(),
    plugins: [nextCache({ revalidate: 300 })],
  });
  // Reuse the config the shared client already holds (route map, modules).
  const config = hp.config.peek();
  if (config) client.config.hydrate(config, hp.config.etag);
  return client;
}

/**
 * The store config for this render, or null when Headpress cannot be reached. Cached per request;
 * across requests the shared client keeps it (ETag revalidation) and the Data Cache tags it
 * `headpress:config`, which the revalidation webhook expires.
 */
export const getStoreConfig = cache(async (): Promise<StoreConfig | null> => {
  try {
    return await hp.config.get();
  } catch (error) {
    console.error("[starter] Could not load the Headpress store config:", error);
    return null;
  }
});
