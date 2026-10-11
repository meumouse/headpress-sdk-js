/**
 * Storefront path → what lives there, from the store's route map (`config.routes`).
 *
 * The catch-all page asks `hp.routes.matches(path)` for every route the path fits, most specific
 * first (Headpress's own ordering), and takes the first one whose object exists: `/aneis` may be a
 * product category or a page, `/carrinho` is the cart when the store calls it that. No storefront
 * path is hardcoded here; a route the store turned off never matches.
 */
import { cache } from "react";

import type { Category, ContentResult, Product, RouteMatch } from "@meumouse.com/headpress";

import { hp } from "../headpress";
import { getStoreConfig } from "../headpress-server";

export type Resolved =
  | { kind: "product"; match: RouteMatch; product: Product; variations: Product[] }
  | { kind: "product_review"; match: RouteMatch; product: Product }
  | { kind: "term"; match: RouteMatch; taxonomy: "product_cat" | "product_tag"; term: Category }
  | { kind: "shop"; match: RouteMatch }
  | { kind: "content"; match: RouteMatch; content: ContentResult }
  | { kind: "cart" | "checkout" | "account"; match: RouteMatch }
  | { kind: "order_received"; match: RouteMatch }
  | { kind: "account_order"; match: RouteMatch; orderId: number };

const terms = cache(async (taxonomy: "product_cat" | "product_tag") =>
  taxonomy === "product_cat" ? hp.catalog.categories() : hp.catalog.tags(),
);

async function resolveMatch(match: RouteMatch, path: string): Promise<Resolved | null> {
  const slug = match.tokens.slug ?? match.tokens.path ?? "";
  switch (match.key) {
    case "product": {
      const product = await hp.catalog.get(slug);
      if (!product || product.parentId) return null;
      const variations = product.type === "variable" ? await hp.catalog.variations(product.id) : [];
      return { kind: "product", match, product, variations };
    }
    case "product_review": {
      const product = await hp.catalog.get(slug);
      return product && !product.parentId ? { kind: "product_review", match, product } : null;
    }
    case "product_cat":
    case "product_tag": {
      const list = await terms(match.key);
      // `{path}` patterns carry the parent slugs too: the last segment is the term's own slug.
      const own = slug.split("/").filter(Boolean).pop() ?? "";
      const term = list.find((entry) => entry.slug === own);
      return term ? { kind: "term", match, taxonomy: match.key, term } : null;
    }
    case "shop":
      return { kind: "shop", match };
    case "cart":
    case "checkout":
    case "account":
      return { kind: match.key, match };
    case "order_received":
      return { kind: "order_received", match };
    case "account_order": {
      const orderId = Number(match.tokens.order_id);
      return Number.isInteger(orderId) && orderId > 0 ? { kind: "account_order", match, orderId } : null;
    }
    case "home":
      return null;
    default: {
      // page, post, blog and custom post types: whatever the content module publishes there.
      if (!hp.capabilities.has("content")) return null;
      const content = await hp.content.get({ path });
      return content ? { kind: "content", match, content } : null;
    }
  }
}

/** What the path resolves to, or null (404). Cached per request: metadata and page share it. */
export const resolvePath = cache(async (path: string): Promise<Resolved | null> => {
  const config = await getStoreConfig();
  if (!config) throw new Error("Headpress is unreachable: cannot resolve storefront paths without the route map.");
  for (const match of hp.routes.matches(path)) {
    const resolved = await resolveMatch(match, path);
    if (resolved) return resolved;
  }
  return null;
});

/**
 * Tokens a route carries in its query string (`/checkout/order-received?order_id={order_id}&key={order_key}`):
 * `routes.match()` reads the path only, so the query part of the pattern says which parameter holds
 * which token.
 */
export function routeQueryTokens(pattern: string | null, searchParams: Record<string, string | string[] | undefined>): Record<string, string> {
  const query = pattern?.split("?")[1];
  if (!query) return {};
  const tokens: Record<string, string> = {};
  for (const [param, template] of new URLSearchParams(query)) {
    const token = /^\{([a-z_]+)\}$/.exec(template)?.[1];
    const value = searchParams[param];
    const text = Array.isArray(value) ? value[0] : value;
    if (token && text) tokens[token] = text;
  }
  return tokens;
}
