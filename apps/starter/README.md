# Headpress Starter (Next.js)

A minimal storefront for a WordPress + WooCommerce site running [Headpress](https://meumouse.com),
built only with [`@meumouse.com/headpress`](../../packages/headpress) and the components of the
[Headpress shadcn registry](../../registry). It is the reference for how a store wires the SDK, and the
app the SDK's end-to-end checks run against.

The rule it follows is the SDK's: **the storefront shows what the server decided.** Prices, Pix
discounts, installments, shipping, coupons, stock, payment method kinds and "is this order paid" all
come from Headpress or the WooCommerce Store API. No page computes a discount or guesses a value.

- Next.js 16 (App Router, Turbopack, `proxy.ts`), React 19, TypeScript strict
- Tailwind CSS v4 and shadcn/ui (new-york style)
- Every storefront URL comes from the store's route map (`config.routes`): no product, category, cart
  or checkout path is hardcoded

## Environment

Copy `.env.example` to `.env.local`.

| Variable | Required | What it is |
| --- | --- | --- |
| `NEXT_PUBLIC_WP_URL` | yes | The WordPress site running Headpress, e.g. `https://wp.example.com` |
| `NEXT_PUBLIC_HEADPRESS_PUBLISHABLE_KEY` | when enforced | Publishable key (`hp_pk_…`) |
| `NEXT_PUBLIC_SITE_URL` | no | This storefront's public origin, for the sitemap index and `robots.txt`. Defaults to `config.store.urls.storefront` |
| `HEADPRESS_SECRET_KEY` | recommended | Secret key (`hp_sk_…`), server only. The auth routes forward the shopper's IP with it, so Headpress rate-limits per shopper |
| `HEADPRESS_WEBHOOK_SECRET` | for revalidation | Secret of the revalidation webhook. Without it `/api/revalidate` refuses every delivery |
| `NODE_TLS_REJECT_UNAUTHORIZED=0` | local only | For a WordPress with a self-signed certificate (Local, `*.local`). Never in production |

## Running against a Headpress site

From the monorepo root (the SDK is a workspace link, so build it once):

```bash
pnpm install
pnpm --filter @meumouse.com/headpress build
pnpm --filter @meumouse.com/headpress-starter dev        # http://localhost:3000
pnpm --filter @meumouse.com/headpress-starter typecheck
pnpm --filter @meumouse.com/headpress-starter lint
pnpm --filter @meumouse.com/headpress-starter build
```

In Headpress:

1. **CORS.** The browser calls Headpress directly (cart, reviews, search, checkout), so the
   storefront origin (`http://localhost:3000` in development) must be in Headpress's allowed origins.
2. **Storefront URL and route map.** Set the storefront URL and the routes (Storefront settings).
   The starter resolves every path through `config.routes`; a route the store turns off simply 404s.
3. **Revalidation.** Point the webhook at `https://<storefront>/api/revalidate` with the same secret as
   `HEADPRESS_WEBHOOK_SECRET`.

`next build` renders the home page and reads the store config, so Headpress must be reachable during
the build.

## How the pages map to the SDK and the registry

| Route | File | SDK | Registry |
| --- | --- | --- | --- |
| `/` | `src/app/page.tsx` | `hp.catalog.list()` | `headpress-price` |
| Any storefront path | `src/app/[...slug]/page.tsx` + `src/lib/data/resolve.ts` | `hp.routes.matches()`, then the first route whose object exists | — |
| `product` | `modules/products/templates/product-template.tsx` | `catalog.get()`, `catalog.variations()`, `useCart()`, `seoMetadata()` | `headpress-price`, `headpress-installments`, `headpress-shipping-calculator`, `headpress-product-reviews` |
| `product_review` | `modules/products/templates/review-template.tsx` | `hp.reviews` (through the form) | `headpress-review-form` |
| `product_cat`, `product_tag`, `shop` | `modules/catalog/templates/catalog-template.tsx` | `catalog.list()` with `category`/`tag`/`search`, `catalog.facets()` (price range), sort, pages | `headpress-price` |
| `page`, `post`, `blog`, custom post types | `modules/content/templates/content-template.tsx` | `hp.content.get({ path })` | — |
| `cart` | `modules/cart/templates/cart-template.tsx` | `useCart()` (limits, coupon, totals, `cart.freeShipping`); server-rendered first with `createRequestHeadpress()` + `requestCartToken()` | — |
| `checkout` | `modules/checkout/templates/checkout-template.tsx` | `cart.updateCustomer()`, shipping rates, `checkout.paymentMethods()` (`kind` from the server), `checkout.place()` with `brazilianMarketValues()`, `checkoutAttribution()`, `checkoutConsent()` | `headpress-address-form`, `headpress-split-payment-picker` |
| `order_received` | `modules/checkout/templates/order-received-template.tsx` | `payments.summary()` polled while a payment is pending, `trackPurchase()` once the server says paid | `headpress-pix-instructions` |
| `account`, `account_order` | `modules/account/templates/*` | `useCustomer()`, `auth.login()`, `auth.logout()`, `customer.orders.list()` / `get()` | `headpress-otp-login` |
| `/api/auth/*` | `src/app/api/auth/[...action]/route.ts` | `createAuthHandler()` (BFF for `bffSession()`) | — |
| `/api/revalidate` | `src/app/api/revalidate/route.ts` | `createRevalidateRoute()` | — |
| `/sitemap_index.xml`, `/<type>-sitemap<n>.xml` | `src/app/sitemap_index.xml`, `src/app/sitemaps/[type]/[page]` (rewritten in `proxy.ts`) | `seo.sitemapIndex()`, `seo.sitemap()`, `renderSitemapIndex()`, `renderSitemap()` | — |
| `/robots.txt` | `src/app/robots.ts` | route map for the private paths | — |
| every request | `src/proxy.ts` | `createRedirectResolver()` + `redirectResponse()` (SEO plugin redirects) | — |

Shared pieces:

- `src/lib/headpress.ts` — the client shared by server and client components: `createHeadpress()` with
  `bffSession()` (browser only), `cookieCartToken()`, the pt-BR messages and `nextCache()`.
- `src/lib/headpress-server.ts` — `createRequestHeadpress()` (per request: the shopper's Cart-Token and
  the secret key through `createServerHeadpress()`) and `getStoreConfig()`.
- `src/modules/layout` — `HeadpressProvider` seeded with the server's config, the header with
  `HeadpressSearchDialog`, and `HeadpressCookieConsent` wired to `createConsent()` + `recordConsent()`.
- `src/modules/analytics/analytics-provider.tsx` — `createConsent()`, `createAttribution()` and
  `createTracker()` with `providersFromConfig()` and `createRelay()`; page views on navigation.

## The registry components

The components in `src/components/headpress-*.tsx` and the primitives in `src/components/ui` were
installed with the shadcn CLI from the registry build, exactly as a store would:

```bash
npx shadcn@4.21.0 add ../../registry/public/r/headpress-price.json   # or the registry URL
```

They are left as the CLI wrote them. Two things in the starter work around current registry issues
and are marked in the code: `cookie-banner.tsx` hands the banner a `Consent` whose `get()` is cached,
and `eslint.config.mjs` reports the React Compiler lint findings in those files as warnings.

## What it leaves out

- Card payments: card gateways need a payment adapter (`definePaymentAdapter()`) for the gateway's
  tokenization. The checkout lists them disabled.
- Password reset, payment links (`order_pay`), wishlist, saved addresses and Google sign-in have SDK
  support but no page here yet.
