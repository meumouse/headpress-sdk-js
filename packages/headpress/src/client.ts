/**
 * `createHeadpress()`: the client a storefront talks to Headpress through.
 *
 * ```ts
 * import { createHeadpress, cookieCartToken } from "@meumouse/headpress";
 * import { ptBR } from "@meumouse/headpress/messages/pt-BR";
 *
 * export const hp = createHeadpress({
 *   baseUrl: "https://wp.example.com",
 *   publishableKey: "hp_pk_…",
 *   cartToken: cookieCartToken(),
 *   messages: ptBR,
 * });
 *
 * const config = await hp.config.get();
 * hp.capabilities.has("split_payments");
 * hp.routes.path("product", { slug: "anel-c152" });
 * ```
 *
 * Domain resources (catalog, cart, checkout, account…) are added phase by phase; until then
 * `hp.request()` reaches any route with the same headers, auth and error handling.
 */
import { createAuth, type Auth } from "./auth.js";
import { createCapabilities, type Capabilities } from "./capabilities.js";
import { createCartResource, type CartOptions, type CartResource } from "./cart.js";
import { createCatalog, type Catalog } from "./catalog.js";
import { checkoutCurrency, createCheckout, type Checkout } from "./checkout.js";
import { createContent, type Content } from "./content.js";
import { createCustomer, type CustomerResource } from "./customer.js";
import type { CartTokenStore } from "./cart-token.js";
import { createConfigStore, type ConfigOptions, type ConfigStore, type HeadpressWarning } from "./config.js";
import { SERVER_AUTH, type InternalOptions } from "./internal.js";
import { formatError, type Messages } from "./messages.js";
import { formatMoney, type FormatMoneyOptions, type Money } from "./money.js";
import { createPayments, type Payments } from "./payments.js";
import type { AnyPlugin, PluginContext, PluginResources } from "./plugin.js";
import { createReviews, type Reviews } from "./reviews.js";
import { createRoutes, type Routes } from "./routes.js";
import { createSearch, type Search } from "./search.js";
import { createSeo, type Seo } from "./seo.js";
import type { TokenStore } from "./session.js";
import { createTransport, type Transport, type TransportHooks } from "./transport.js";

export interface HeadpressOptions<P extends readonly AnyPlugin[] = readonly []> extends InternalOptions {
  /** WordPress site URL, e.g. `https://wp.example.com`. */
  baseUrl: string;
  /** Publishable key (`hp_pk_…`). Required when the store enforces it. */
  publishableKey?: string;
  /** Where the customer's tokens live. Without one, customer calls need an explicit `accessToken`. */
  session?: TokenStore;
  /** Where the Store API Cart-Token lives. */
  cartToken?: CartTokenStore;
  /** BCP 47 locale for texts and money. Defaults to the store's language, then `en-US`. */
  locale?: string;
  /** Error texts, lowest priority first (`ptBR` from `@meumouse/headpress/messages/pt-BR`, then overrides). */
  messages?: Messages | readonly Messages[];
  /** Custom `fetch` (tests, instrumentation, a framework's patched fetch). */
  fetch?: typeof fetch;
  /** Milliseconds before a request fails with `headpress_timeout`. Defaults to 20 000. */
  timeoutMs?: number;
  /** REST prefix of the site. Defaults to `/wp-json`. */
  restPrefix?: string;
  /** Headers sent on every request. */
  headers?: Readonly<Record<string, string>>;
  config?: ConfigOptions;
  cart?: CartOptions;
  plugins?: P;
  /** Non-fatal problems (stale config, newer config schema). Defaults to `console.warn`. */
  onWarning?: (warning: HeadpressWarning) => void;
}

export interface HeadpressClient {
  readonly baseUrl: string;
  readonly config: ConfigStore;
  readonly capabilities: Capabilities;
  readonly routes: Routes;
  /** SEO heads, redirect rules and sitemaps (`seo` module). */
  readonly seo: Seo;
  /** Products, variations, categories, tags and filter counts (Store API). */
  readonly catalog: Catalog;
  /** The shopper's cart (Store API, Cart-Token). */
  readonly cart: CartResource;
  /** Product search (`search` module). */
  readonly search: Search;
  /** Posts, pages, menus and previews (`content` module). */
  readonly content: Content;
  /** Sign-in: password, one-time codes (WhatsApp, e-mail), Google; sign-out. */
  readonly auth: Auth;
  /** The signed-in customer's account. */
  readonly customer: CustomerResource;
  /** Product reviews (`reviews` module). */
  readonly reviews: Reviews;
  /** Payment methods, placing orders, retries, split quotes, shipping and installment quotes. */
  readonly checkout: Checkout;
  /** Order payment ledgers, balance payments and payment links (`split_payments` module). */
  readonly payments: Payments;
  readonly session: TokenStore | undefined;
  readonly cartToken: CartTokenStore | undefined;
  /** Call any route; see `RequestOptions`. */
  readonly request: Transport["request"];
  /** Call any route and get the status and headers too. */
  readonly raw: Transport["raw"];
  /** Absolute URL of a route. */
  readonly url: Transport["url"];
  /** The client's locale: the option, else the store's language, else `en-US`. */
  locale(): string;
  /** Shopper-facing text for an error, from the client's and the plugins' dictionaries. */
  formatError(error: unknown, context?: string): string;
  /** Text for an amount in the client's locale, or in the store's WooCommerce format with `{ format }`. */
  formatMoney(value: Money, options?: FormatMoneyOptions): string;
}

export type Headpress<P extends readonly AnyPlugin[] = readonly []> = HeadpressClient & PluginResources<P>;

const RESERVED = new Set([
  "baseUrl",
  "config",
  "capabilities",
  "routes",
  "seo",
  "catalog",
  "cart",
  "search",
  "content",
  "auth",
  "customer",
  "reviews",
  "checkout",
  "payments",
  "session",
  "cartToken",
  "request",
  "raw",
  "url",
  "locale",
  "formatError",
  "formatMoney",
]);

function assertBaseUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new TypeError(`baseUrl must be an absolute URL, got "${baseUrl}".`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError(`baseUrl must use http or https, got "${parsed.protocol}".`);
  }
}

export function createHeadpress<const P extends readonly AnyPlugin[] = readonly []>(
  options: HeadpressOptions<P>,
): Headpress<P> {
  assertBaseUrl(options.baseUrl);
  const plugins: readonly AnyPlugin[] = options.plugins ?? [];
  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (RESERVED.has(plugin.name)) throw new TypeError(`Plugin name "${plugin.name}" clashes with the client.`);
    if (seen.has(plugin.name)) throw new TypeError(`Two plugins are named "${plugin.name}".`);
    seen.add(plugin.name);
  }

  const warned = new Set<string>();
  const onWarning =
    options.onWarning ??
    ((warning: HeadpressWarning) => {
      if (warned.has(warning.code)) return;
      warned.add(warning.code);
      console.warn(`[headpress] ${warning.message}`);
    });

  // The config store needs the transport and the transport asks the config which modules are on;
  // the late binding below closes the loop.
  let capabilities: Capabilities | null = null;
  const hooks: readonly TransportHooks[] = plugins;

  const transport = createTransport({
    baseUrl: options.baseUrl,
    restPrefix: options.restPrefix,
    publishableKey: options.publishableKey,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
    headers: options.headers,
    session: options.session,
    cartToken: options.cartToken,
    isModuleEnabled: (id) => (capabilities?.known() ? capabilities.has(id) : undefined),
    captchaHeader: () => {
      const header = capabilities?.get("captcha")?.header;
      return typeof header === "string" && header ? header : undefined;
    },
    serverAuth: options[SERVER_AUTH],
    hooks: () => hooks,
  });

  const configStore = createConfigStore(transport, { ...options.config, onWarning });
  capabilities = createCapabilities(() => configStore.peek());
  const routes = createRoutes(
    () => configStore.peek()?.routes,
    () => configStore.peek()?.store.urls.storefront,
  );

  const locale = (): string => options.locale ?? configStore.peek()?.store.language ?? "en-US";
  const customer = createCustomer(transport, options.session, () => configStore.peek()?.commerce?.currency.minor_unit ?? 2);

  const dictionaries = (): Messages[] => {
    const own = Array.isArray(options.messages)
      ? [...(options.messages as readonly Messages[])]
      : options.messages
        ? [options.messages as Messages]
        : [];
    const current = locale();
    const language = current.split("-")[0] ?? current;
    const fromPlugins = plugins.flatMap((plugin) => {
      const byLocale = plugin.messages ?? {};
      const match = byLocale[current] ?? byLocale[language];
      return match ? [match] : [];
    });
    // Looked up last-first, so plugin texts win over the client's dictionaries: the store's plugin
    // is where it words its own rules and its add-on's codes.
    return [...own, ...fromPlugins];
  };

  const client: HeadpressClient = {
    baseUrl: options.baseUrl,
    config: configStore,
    capabilities,
    routes,
    seo: createSeo(transport),
    catalog: createCatalog(transport, routes, () => configStore.get()),
    cart: createCartResource(transport, options.cartToken, { ...options.cart, storefrontUrl: () => configStore.peek()?.store.urls.storefront }),
    search: createSearch(transport),
    content: createContent(transport),
    auth: createAuth({
      transport,
      session: options.session,
      cartToken: options.cartToken,
      loadCustomer: () => customer.me(),
    }),
    customer,
    reviews: createReviews(transport),
    checkout: createCheckout(transport, options.cartToken, () => checkoutCurrency(configStore.peek()?.commerce?.currency)),
    payments: createPayments(transport, () => configStore.peek()?.commerce?.currency.minor_unit ?? 2),
    session: options.session,
    cartToken: options.cartToken,
    request: transport.request,
    raw: transport.raw,
    url: transport.url,
    locale,
    formatError: (error, context) => formatError(error, { messages: dictionaries(), context }),
    formatMoney: (value, formatOptions = {}) => formatMoney(value, { locale: locale(), ...formatOptions }),
  };

  const context: PluginContext = {
    request: transport.request,
    raw: transport.raw,
    url: transport.url,
    config: configStore,
    capabilities,
    routes,
    locale,
  };

  const extended: Record<string, unknown> = { ...client };
  for (const plugin of plugins) {
    if (plugin.setup) {
      const resources = plugin.setup(context);
      if (resources !== undefined) extended[plugin.name] = resources;
    }
  }

  return Object.freeze(extended) as Headpress<P>;
}
