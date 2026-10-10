# Migrating a storefront to `@meumouse/headpress`

How to move a storefront that calls Headpress (and the WooCommerce Store API) with its own fetch
code onto the SDK, one area at a time, without a big-bang release. This is the order the first store
(Camila Maehler) followed.

## Compatibility

| @meumouse/headpress | Headpress | WooCommerce | Node.js | Next.js (adapters) | React (bindings) |
| --- | --- | --- | --- | --- | --- |
| 0.x / 1.x | 1.2+ — 1.3 for price previews, split and shipping quotes, `commerce.policies` and `headpress_version` | 9.0+ | 20.19+ | 15+ | 18.2+ |

The store config contract is `schema_version` 1. The client warns (once) when Headpress sends a newer
schema or reports a version below `MIN_HEADPRESS_VERSION`.

## Order of the work

Each step keeps the storefront working and can ship on its own.

1. **Transport.** Create the client and re-implement your fetch helper on top of `hp.request()`.
   Existing call sites keep working; errors become `HeadpressError` (code, status, data). Keep your
   UI's error mapping for now, or move it to `formatError()` dictionaries.
2. **Server.** Store config through `hp.config` (with `nextCache()` tags), the revalidation webhook
   through `/webhooks` or `createRevalidateRoute()`, redirects through `createRedirectResolver()`,
   SEO heads through `hp.seo.head()` + `toNextMetadata()`. A read-through cache you already have can
   run on `swr()` with `redisCache()`.
3. **Catalog, cart and search.** Replace WooCommerce REST (`wc/v3`, admin keys) with `hp.catalog`
   on the Store API — no keys left in the storefront. Move the cart to `hp.cart` and the Cart-Token
   to `cookieCartToken()`; migrate a token stored elsewhere once (read it, `cartToken.set()` it).
4. **Accounts.** Mount `createAuthHandler()` and switch the browser to `bffSession()`. Customers
   signed in with the old cookie sign in again once unless you migrate the refresh token cookie
   name (`cookies.refresh`).
5. **Checkout and payments.** `hp.checkout.paymentMethods()` (kinds from the server — delete any
   gateway-id guessing), `place()` with `extensions.headpress` options, `paymentInstructions()`,
   `hp.payments` for ledgers and payment links. Replace locally computed Pix prices, installments
   and split shares with `pricePreview`, `installments()` and `quoteSplit()`.
6. **Analytics.** Consent, tracker, providers, relay, attribution and `trackPurchase()` from
   `/analytics`; make sure the purchase uses `purchaseEventId()` everywhere.
7. **UI.** Replace hand-written widgets with registry components where they fit; keep your design
   by editing the copied files.

## Things that change on the way

- **Money** is `Money` (integer minor units). Format with `hp.formatMoney()`; never `parseFloat`
  WooCommerce strings again (`moneyFromDecimal()` parses them without float error).
- **Public reads go out without the customer's token** (`auth: "none"` by default), so Headpress
  keeps them cacheable.
- **A missing route in `config.routes` is a route the store turned off**: `hp.routes.path()`
  answers null; render no link instead of guessing one.
- **Store rules belong in a plugin** (`definePlugin`) in the storefront repository, not in forks of
  the SDK.
