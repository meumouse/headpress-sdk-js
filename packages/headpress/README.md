# @meumouse.com/headpress

Typed, framework-agnostic client for [Headpress](https://meumouse.com), the headless commerce engine
for WordPress and WooCommerce.

- **One client for the whole contract**: Headpress (`headpress/v1`) and the WooCommerce Store API
  (`wc/store/v1`), with the right headers on each call and nothing more.
- **Runs anywhere**: browsers, Node.js 20.19+, edge runtimes, Bun and Deno. No runtime dependencies.
- **The server decides, the SDK shows**: prices, discounts, installments, shipping and eligibility
  come from Headpress. The SDK never makes up a number.
- **Extensible**: a store adapts it to its own Headpress add-ons with plugins, without forking.

> Status: `0.x`, under active development. Domains land phase by phase; see the changelog.

## Install

```bash
npm install @meumouse.com/headpress
```

## Quick start

```ts
import { cookieCartToken, createHeadpress } from "@meumouse.com/headpress";
import { ptBR } from "@meumouse.com/headpress/messages/pt-BR";

export const hp = createHeadpress({
  baseUrl: "https://wp.example.com",
  publishableKey: "hp_pk_…",
  cartToken: cookieCartToken(), // first-party `hp_cart` cookie, readable on server and client
  messages: ptBR,
});

const config = await hp.config.get(); // GET /store/config, cached with ETag revalidation

if (hp.capabilities.has("split_payments")) {
  // the store has split payments on
}

hp.routes.path("product", { slug: "ring-c152" }); // "/produto/ring-c152", from config.routes
hp.routes.match("/aneis"); // { key: "product_cat", tokens: { slug: "aneis" } }
```

Until a domain has its own resource, `hp.request()` reaches any route with the same handling:

```ts
const reviews = await hp.request("/store/products/123/reviews", { query: { page: 2 }, module: "reviews" });
const cart = await hp.request("/cart", { api: "store", auth: "optional", cartToken: true });
```

## Requests

| Option | What it does |
| --- | --- |
| `api` | `headpress` (default), `store` for `wc/store/v1`, or any namespace (`cm-precheckout/v1`) |
| `auth` | `none` (default; keeps public routes cacheable), `optional`, `required` |
| `cartToken` | Sends the stored Cart-Token and stores the one that comes back |
| `captcha` | Captcha token, sent in the header the captcha module names |
| `module` | Fails fast with `headpress_module_disabled` when the store has the module off |
| `query`, `body` | Query parameters; JSON body (or `FormData`, `URLSearchParams`, `Blob`, string) |
| `ifNoneMatch` | Conditional request; a 304 resolves `raw()` with `notModified: true` |
| `fetchOptions` | Passed to `fetch`, e.g. Next.js `{ next: { tags: ["headpress:config"] } }` |

A 401 on a customer call refreshes the session once, shared by every call that hit it, and replays.

## Errors

Every failure is a `HeadpressError` with `code`, `status` (0 when no response arrived) and `data`.
Branch on `code`, and turn errors into shopper-facing text with the dictionaries:

```ts
import { isHeadpressError } from "@meumouse.com/headpress";

try {
  await hp.request("/store/auth/otp/verify", { body: { challenge_id, code } });
} catch (error) {
  if (isHeadpressError(error, "headpress_otp_invalid")) error.data.attempts_left; // typed
  showToast(hp.formatError(error, "login")); // "<code>@login" entries win over "<code>"
}
```

Dictionaries ship for `pt-BR`, `en` and `es`; pass your own after them to override entries.

Some codes are raised by the SDK itself, before any request: `headpress_not_authenticated` (401) for
a customer call without a session — where Headpress would answer `headpress_unauthorized` —,
`headpress_module_disabled` (404) for a module the loaded config has off, and `headpress_network_error`,
`headpress_timeout` and `headpress_aborted` (status 0).

## Money

Amounts are integers in minor units, in one `Money` shape whatever the source:

```ts
import { formatMoney, moneyFromDecimal, moneyFromMinor } from "@meumouse.com/headpress";

const price = moneyFromMinor("129990", config.commerce!.currency); // Store API / Headpress
formatMoney(price!, { format: config.commerce!.currency }); // "R$ 1.299,90", like WooCommerce
moneyFromDecimal("199.90", "BRL"); // WooCommerce REST strings, parsed without float drift
```

## Sessions and the Cart-Token

The SDK asks a `TokenStore` for the customer's access token and a `CartTokenStore` for the cart
token; it never decides where they live. `memorySession()`, `cookieCartToken()`,
`localStorageCartToken()` and `memoryCartToken()` ship in the core; framework adapters add a
backend-for-frontend session with the refresh token in an httpOnly cookie.

On the server, never share one session between requests: create the client per request, or pass
`accessToken` on each call.

## Plugins

A plugin adds resources for a store's own Headpress add-on, adjusts requests, translates errors and
brings its own texts. Its resources are typed on the client:

```ts
import { createHeadpress, definePlugin } from "@meumouse.com/headpress";

const store = definePlugin({
  name: "store",
  setup: ({ request }) => ({
    welcomeCoupon: (email: string, captcha: string) =>
      request<{ coupon: string }>("/store/cm/discounts/welcome", { body: { email }, captcha, module: "cm_marketing" }),
  }),
  messages: { "pt-BR": { cm_invalid_cpf: "CPF inválido." } },
});

const hp = createHeadpress({ baseUrl, plugins: [store] });
await hp.store.welcomeCoupon("ana@example.com", token);
```

Type an add-on's module config and error data through declaration merging:

```ts
declare module "@meumouse.com/headpress" {
  interface ModuleConfigMap {
    cm_store: { enabled: true; welcome_coupon: { enabled: boolean; percent: number } };
  }
  interface ErrorDataMap {
    cm_invalid_cpf: { field?: string };
  }
}
```

## Server

`@meumouse.com/headpress/server` adds what must never reach a browser: the secret key for Headpress
`server/*` routes, and the shopper's IP forwarded for rate limiting. Bundlers resolve it to a stub
that throws in browser builds.

```ts
import { clientIp, createServerHeadpress } from "@meumouse.com/headpress/server";

const hp = createServerHeadpress({ baseUrl, secretKey: process.env.HEADPRESS_SECRET_KEY });

await hp.request("/server/revalidate", { secret: true, body: { tags: ["product:list"] } });
await hp.request("/store/auth/login", {
  body: { login, password },
  clientIp: clientIp(request.headers, { cloudflare: true }), // rightmost untrusted X-Forwarded-For hop
});
```

## Catalog, cart and search

```ts
const page = await hp.catalog.list({ category: "aneis", orderby: "price", order: "asc", perPage: 12 });
page.items[0].price; // Money — and pricePreview (Pix price, best installment) when Headpress publishes it
const product = await hp.catalog.get("anel-c152"); // by slug or id; null when it does not exist
const facets = await hp.catalog.facets({ category: "aneis" }, { attributes: [{ taxonomy: "pa_cor" }] });

const cart = await hp.cart.addItem({ id: product.id, quantity: 1 });
cart.totals.total; // the server's numbers; cart.freeShipping is the server's progress too
hp.cart.subscribe((next) => render(next)); // every widget sees the same cart

const suggestions = await hp.search.suggest("anel");
highlightSegments(item.name, item.highlight.name); // [{ text, match }]
const post = await hp.content.get({ path: "/blog/guia-de-tamanhos" });
```

The cart fetches a Cart-Token before its first write and replaces a token the Store API refuses,
replaying the call once. In Next.js server code, read the shopper's token with
`requestCartToken()` from `@meumouse.com/headpress/next/server`.

## Accounts

```ts
// Browser: the refresh token stays in an httpOnly cookie on your server
const hp = createHeadpress({ baseUrl, session: bffSession({ basePath: "/api/auth" }), cartToken: cookieCartToken() });

// app/api/auth/[...action]/route.ts (from @meumouse.com/headpress/next/server)
export const { POST } = createAuthHandler({ baseUrl, publishableKey, secretKey: process.env.HEADPRESS_SECRET_KEY });

await hp.auth.restore(); // after a page load: the customer, or null for guests
await hp.auth.login({ login, password }, { captcha });
const challenge = await hp.auth.otp.start({ channel: "whatsapp", recipient: "+5551999999999" }, { captcha });
const result = await hp.auth.otp.verify({ challengeId: challenge.challenge_id, code });
if (result.status === "needs_registration") await hp.auth.otp.register({ registrationToken: result.registrationToken, email });
await hp.auth.google(credential);

await hp.customer.orders.list({ status: ["processing", "completed"] }); // totals as Money
await hp.customer.wishlist.add(57);
await hp.customer.addresses.create({ label: "Casa", postcode: "01310-100" /* … */ });
await hp.reviews.create(57, { rating: 5, title: "Perfeito", content: "…", media: [{ id, token }] });
```

Signing in stores the tokens and the customer's Cart-Token (the guest cart is merged into it).
Without a BFF, `memorySession({ refresh })` keeps both tokens (scripts, apps with secure storage).

## Checkout and payments

```ts
import { brazilianMarketValues } from "@meumouse.com/headpress/br";

const methods = await hp.checkout.paymentMethods(); // kind, installments and discount rule come from the server
const order = await hp.checkout.place({
  billingAddress,
  paymentMethod: "woo-mercado-pago-pix",
  fields: brazilianMarketValues({ document: cpf, number: "1000", neighborhood: "Bela Vista" }),
  attribution, consent, captcha,
});
order.instructions; // { type: "pix", code, imageBase64, expiresAt } or { type: "boleto", url, barcode }

await hp.checkout.retryPayment(order.orderId, { key: order.orderKey, paymentMethod: "woo-mercado-pago-pix" });
await hp.checkout.quoteSplit([{ gatewayId: "asaas-pix", amount: 12000 }, { gatewayId: "asaas-credit-card", amount: 10000 }]);
await hp.payments.summary(orderId, { key }); // the order's ledger: paid, pending, remaining, Pix codes
await hp.checkout.shippingQuote({ productId, postcode: "01310-100" });
```

The SDK never computes a discount, an installment or a split share: it shows the server's numbers
(`quoteSplit()`, `pricePreview`, `installments()`). Gateway-specific card forms plug in as
payment adapters (`definePaymentAdapter()`), matched by the server's `kind`.

`@meumouse.com/headpress/br` has CPF/CNPJ (masks and check digits, person type), CEP (mask, ViaCEP),
Brazilian phones (canonical `55…`) and the Brazilian Market checkout fields.

## Analytics and consent

`@meumouse.com/headpress/analytics` handles cookie consent, GA4-style events, the GA4 / Meta Pixel /
Pinterest tags, Headpress's Conversions API relay, purchases, order attribution and abandoned carts.
It is safe to import on the server; every browser API is guarded.

- **Consent first.** The decision lives in a first-party cookie (`hp_consent`) and follows
  `modules.consent`; a decision made under an older consent `version` counts as undecided. Until the
  shopper decides, events wait in a queue; on the decision they go only to the providers it allows.
  Refused events are dropped, never replayed.
- **One `event_id` per event.** The browser pixel and the server copy (the relay, or the purchase
  Headpress sends from the paid order as `purchase_<order id>`) share it, so each platform counts it
  once. `purchaseEventId()` is the only place that id is built.
- **Amounts in major units**, as the platforms expect; build them from `Money` with the item helpers.

```ts
import {
  createConsent, createTracker, createRelay, providersFromConfig, recordConsent,
  createAttribution, browserIds, checkoutAttribution, checkoutConsent,
  productEventParams, trackPurchase, captureAbandonedCart, consumeRecoveryToken,
} from "@meumouse.com/headpress/analytics";

const config = await hp.config.get();
const consent = createConsent({ config: () => hp.capabilities.get("consent") });
consent.subscribe((state) => void recordConsent(hp, state)); // proof of consent, when the store keeps it

const tracker = createTracker({
  consent,
  providers: providersFromConfig(config, { load: true }), // tags load only after consent
  relay: createRelay(hp), // when meta_pixel / pinterest relay_events is on
});

const attribution = createAttribution();
attribution.capture(); // on every navigation
tracker.track("add_to_cart", productEventParams(product, { quantity: 1 }));

consent.acceptAll(); // banner buttons: or rejectAll(), grant(["analytics"])

await captureAbandonedCart(hp, { email, consent: { marketing: optIn } }); // explicit opt-in required
await hp.checkout.place({
  // …
  attribution: checkoutAttribution(attribution, browserIds(consent.get()), { woocommerce: config.modules.woocommerce, consent: consent.get() }) ?? undefined,
  consent: checkoutConsent(consent.get()),
});

// Confirmation page, once the order is paid: tracked at most once per order per browser
await trackPurchase(hp, tracker, { orderId, key });
```

For a GTM container that loads before the app, push
`gtag("consent", "default", consentModeDefaults(config.modules.consent))` from an inline head
script. Restore abandoned carts from recovery links with `consumeRecoveryToken(location.href, cartToken)`,
then `history.replaceState` to the URL it returns.

## Controllers, React and UI components

Storefront behaviour without a UI lives in `@meumouse.com/headpress/controllers`: each controller is
`{ getState(), subscribe(), actions, destroy() }`, works with any framework, and keeps failures in
`state.error` instead of throwing.

| Controller | Does |
| --- | --- |
| `createCartController` | The shared cart, pending lines, errors |
| `createSearchBox` | Debounced suggestions from `min_chars`, stale answers dropped |
| `createOtpFlow` | start → code → (registration) → signed in; resend countdown, attempts left, channel fallback |
| `createReviewForm` | Fields and files checked against the store's review settings, uploads, submission |
| `createSplitBuilder` | Legs checked against `split_payments`, amounts quoted by the server |
| `createShippingQuote` | CEP and server shipping quotes |
| `createAddressForm` | Brazilian address with ViaCEP fill, validation and checkout fields |

`@meumouse.com/headpress/react` binds them with `useSyncExternalStore` (SSR and StrictMode safe):

```tsx
<HeadpressProvider client={hp} initialConfig={config}>
  <App />
</HeadpressProvider>

const [cart, { addItem }] = useCart();
const [otp, { start, verify }] = useOtpFlow();
const formatMoney = useFormatMoney();
const search = useCapability("search");
```

Ready-made components ship as a [shadcn registry](../../registry/README.md): price (Pix and
installments only from the server's preview), search dialog, product reviews, review form, OTP
login, Pix instructions, shipping calculator, installments, split payment picker, Brazilian
address form and the cookie banner. They are copied into your project, so you own their look.

## SEO

```ts
const head = await hp.seo.head({ path: "/produto/anel-c152" }); // null when nothing is published there
const rules = await hp.seo.redirects(); // Rank Math / Yoast rules, normalized
resolveRedirect(rules, "/old-page/", "?utm=x"); // { destination, status } with Rank Math semantics
const index = await hp.seo.sitemapIndex();
renderSitemapIndex(sitemapIndexEntries(index, (type, page) => `${site}/${type}-sitemap${page > 1 ? page : ""}.xml`));
```

## Webhooks

`@meumouse.com/headpress/webhooks` verifies the revalidation webhook (HMAC-SHA256, 5-minute
tolerance, Web Crypto), skips repeated deliveries and hands over a plan of tags and paths:

```ts
import { createWebhookHandler } from "@meumouse.com/headpress/webhooks";

const handler = createWebhookHandler({
  secret: process.env.HEADPRESS_WEBHOOK_SECRET!,
  onDelivery: async (delivery, plan) => purge(plan.tags, plan.paths), // throw to make Headpress retry
});
// (request: Request) => Promise<Response>, for any Fetch API server
```

## Next.js

```ts
// lib/headpress.ts
import { createHeadpress } from "@meumouse.com/headpress";
import { nextCache } from "@meumouse.com/headpress/next";

export const hp = createHeadpress({ baseUrl, publishableKey, plugins: [nextCache({ revalidate: 300 })] });

// app/api/revalidate/route.ts (from @meumouse.com/headpress/next/server) — tags fetched through the SDK
// expire when Headpress says so
export const { POST } = createRevalidateRoute({ secret: process.env.HEADPRESS_WEBHOOK_SECRET, config: hp.config });

// app/produto/[slug]/page.tsx
export const generateMetadata = ({ params }) => seoMetadata(hp, { path: `/produto/${params.slug}` }, fallback);

// proxy.ts (middleware)
const redirects = createRedirectResolver(hp.seo, { sameHosts: [wpUrl, siteUrl] });
const match = await redirects.resolve(request.nextUrl);
if (match) return redirectResponse(match, request.url);
```

`@meumouse.com/headpress/next` is safe to import from modules client components share;
`@meumouse.com/headpress/next/server` holds the server-only pieces (revalidation route, auth BFF,
request cookies).

`nextCache()` tags every public read with the Headpress cache vocabulary and leaves anything carrying
a customer token or a Cart-Token uncached.

## Server cache

```ts
import { redisCache, swr } from "@meumouse.com/headpress/server";

const store = redisCache(new Redis(process.env.REDIS_URL), { prefix: "shop:" });
const outcome = await swr(store, `product:${slug}`, { ttl: 300, grace: 86_400 }, () => loadProduct(slug));
if (!outcome.ok) showPlaceholder(); // nothing cached and WordPress did not answer
```

Single-flight, stale-while-revalidate and stale-if-error; `ok: false` is never confused with a
value of `null`.

## Compatibility

| @meumouse.com/headpress | Headpress | Node.js |
| --- | --- | --- |
| 0.x | 1.2+ (split quotes, shipping quotes and price previews need 1.3) | 20.19+ |

ESM only. The store config contract is `schema_version` 1; a newer version triggers a warning.

## License

MIT © MeuMouse.com
