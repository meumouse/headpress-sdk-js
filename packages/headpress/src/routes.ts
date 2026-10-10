/**
 * The storefront route map (`config.routes`): which storefront URL each kind of object lives at.
 *
 * Headpress builds every link it hands out — emails, sitemaps, search results, SEO canonicals —
 * from this map, so a storefront that reads it at runtime agrees with WordPress by construction
 * instead of keeping a copy that drifts. These helpers mirror Headpress's `Route_Map`:
 *
 * - `expand` fills the tokens of a pattern and gives up (null) when one is missing, like
 *   `Route_Map::expand()`, so no half-built URL ever reaches a link;
 * - `match` turns a storefront path back into a route key and its tokens, most specific pattern
 *   first, like `Route_Map::matches()` (a page and a category on the same path → the category).
 *
 * A key missing from the map means the store turned that route off (`storefront.disabled_routes`):
 * every helper answers null for it rather than inventing a default.
 */

/** Route keys Headpress defines. Add-ons and custom post types add more (`storefront.custom_routes`). */
export type CoreRouteKey =
  | "home"
  | "blog"
  | "post"
  | "page"
  | "category"
  | "post_tag"
  | "shop"
  | "product"
  | "product_cat"
  | "product_tag"
  | "cart"
  | "checkout"
  | "order_received"
  | "account"
  | "account_order"
  | "password_reset"
  | "product_review"
  | "order_pay";

export type RouteKey = CoreRouteKey | (string & {});

export type RouteMap = { readonly [K in CoreRouteKey]?: string } & { readonly [key: string]: string | undefined };

/**
 * Token values. Headpress tokens: `{slug}`, `{id}`, `{path}` (hierarchical, keeps its slashes),
 * `{order_id}`, `{order_key}`, `{key}`, `{login}`, `{token}`.
 */
export type RouteTokens = Readonly<Record<string, string | number | null | undefined>>;

export interface RouteMatch {
  key: string;
  tokens: Record<string, string>;
}

const TOKEN = /\{([a-z_]+)\}/g;

/**
 * Percent-encode what a URL cannot carry, leaving existing escapes alone: WordPress stores
 * non-ASCII slugs already encoded (`%c3%a1`), and encoding them again would break the link.
 */
function encodeToken(value: string, allowSlash: boolean, inQuery: boolean): string {
  const safe = inQuery ? /[A-Za-z0-9\-._~!$'()*,;:@/?]/ : allowSlash ? /[A-Za-z0-9\-._~!$&'()*+,;=:@/]/ : /[A-Za-z0-9\-._~!$&'()*+,;=:@]/;
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const char = value[i] as string;
    if (char === "%" && /^[0-9A-Fa-f]{2}$/.test(value.slice(i + 1, i + 3))) {
      out += char;
    } else if (safe.test(char)) {
      out += char;
    } else {
      out += encodeURIComponent(char);
    }
  }
  return out;
}

/**
 * Fill a pattern's tokens. Null when a token has no value, so callers never produce a half-built
 * URL. Values are percent-encoded where needed; `{path}` keeps its slashes.
 *
 * @example expandRoute("/produto/{slug}", { slug: "anel-c152" }) // "/produto/anel-c152"
 */
export function expandRoute(pattern: string, tokens: RouteTokens = {}): string | null {
  const queryStart = pattern.indexOf("?");
  let missing = false;

  const fill = (part: string, inQuery: boolean): string =>
    part.replace(TOKEN, (_, name: string) => {
      const raw = tokens[name];
      const value = raw === null || raw === undefined ? "" : String(raw);
      if (value === "") {
        missing = true;
        return "";
      }
      return encodeToken(value, name === "path", inQuery);
    });

  const path = fill(queryStart === -1 ? pattern : pattern.slice(0, queryStart), false);
  const query = queryStart === -1 ? "" : fill(pattern.slice(queryStart), true);
  return missing ? null : path + query;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const regexCache = new Map<string, RegExp | null>();

/** Regex of a pattern's path part (the query is ignored), or null when it cannot be matched. */
export function routeRegex(pattern: string): RegExp | null {
  const cached = regexCache.get(pattern);
  if (cached !== undefined) return cached;

  const path = `/${(pattern.split("?")[0] ?? "").replace(/^\/+|\/+$/g, "")}`;
  let source = "";
  let last = 0;
  for (const match of path.matchAll(TOKEN)) {
    source += escapeRegex(path.slice(last, match.index));
    source += match[1] === "path" ? "(?<path>.+?)" : `(?<${match[1]}>[^/]+)`;
    last = (match.index ?? 0) + match[0].length;
  }
  source += escapeRegex(path.slice(last));

  let regex: RegExp | null;
  try {
    regex = new RegExp(`^${source}$`);
  } catch {
    // A pattern repeating a token name cannot be compiled (nor matched by Headpress).
    regex = null;
  }
  regexCache.set(pattern, regex);
  return regex;
}

/** Literal characters of the path part, times ten, minus five per `{path}`: Headpress's ordering. */
export function routeSpecificity(pattern: string): number {
  const path = pattern.split("?")[0] ?? "";
  const literal = path.replace(TOKEN, "").length;
  const pathTokens = (path.match(/\{path\}/g) ?? []).length;
  return literal * 10 - pathTokens * 5;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePath(path: string): string {
  let pathname = path;
  try {
    pathname = new URL(path, "http://x").pathname;
  } catch {
    pathname = path.split(/[?#]/)[0] ?? "";
  }
  return `/${pathname.replace(/^\/+|\/+$/g, "")}`;
}

/** Every route a storefront path matches, most specific first. */
export function matchRoutes(routes: RouteMap, path: string): RouteMatch[] {
  const target = normalizePath(path);
  const entries = Object.entries(routes).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].startsWith("/"),
  );
  // Stable sort, like PHP's: equally specific patterns keep the map's order.
  entries.sort((a, b) => routeSpecificity(b[1]) - routeSpecificity(a[1]));

  const matches: RouteMatch[] = [];
  for (const [key, pattern] of entries) {
    const result = routeRegex(pattern)?.exec(target);
    if (!result) continue;
    const tokens: Record<string, string> = {};
    for (const [name, value] of Object.entries(result.groups ?? {})) {
      if (typeof value === "string") tokens[name] = safeDecode(value);
    }
    matches.push({ key, tokens });
  }
  return matches;
}

/** The most specific route a storefront path matches, or null. */
export function matchRoute(routes: RouteMap, path: string): RouteMatch | null {
  return matchRoutes(routes, path)[0] ?? null;
}

export interface Routes {
  /** The current map, empty until the store config loads. */
  map(): RouteMap;
  /** Whether the store has this route (a missing key is a route the store turned off). */
  has(key: RouteKey): boolean;
  pattern(key: RouteKey): string | null;
  /** Storefront path for a route, or null when the route is off or a token is missing. */
  path(key: RouteKey, tokens?: RouteTokens): string | null;
  /** Absolute URL on the storefront (`config.store.urls.storefront`), or null. */
  url(key: RouteKey, tokens?: RouteTokens): string | null;
  match(path: string): RouteMatch | null;
  matches(path: string): RouteMatch[];
}

export function createRoutes(
  source: () => RouteMap | null | undefined,
  storefrontUrl: () => string | null | undefined = () => null,
): Routes {
  const map = (): RouteMap => source() ?? {};
  const pattern = (key: RouteKey): string | null => {
    const value = map()[key];
    return typeof value === "string" && value.startsWith("/") ? value : null;
  };
  const path = (key: RouteKey, tokens?: RouteTokens): string | null => {
    const value = pattern(key);
    return value === null ? null : expandRoute(value, tokens);
  };

  return {
    map,
    has: (key) => pattern(key) !== null,
    pattern,
    path,
    url(key, tokens) {
      const relative = path(key, tokens);
      const base = storefrontUrl();
      if (relative === null || !base || !/^https?:\/\//i.test(base)) return null;
      // Concatenated rather than resolved with `new URL()`, which would drop a storefront served
      // from a sub-path (`https://example.com/shop`).
      return `${base.replace(/\/+$/, "")}${relative}`;
    },
    match: (value) => matchRoute(map(), value),
    matches: (value) => matchRoutes(map(), value),
  };
}
