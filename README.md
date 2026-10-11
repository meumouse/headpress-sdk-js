# headpress-sdk-js

The JavaScript side of [Headpress](https://meumouse.com), the headless commerce engine for WordPress
and WooCommerce: the typed SDK [`@meumouse.com/headpress`](packages/headpress), a shadcn component
registry, and a Next.js starter store built only from them.

> **Status:** `0.x`, [published on npm](https://www.npmjs.com/package/@meumouse.com/headpress). The first store (Camila Maehler) is moving onto it;
> `1.0.0` ships once that store runs entirely on the SDK.

## The rule everything follows

**The storefront shows what the server decided.** Prices, Pix discounts, installments, shipping,
split payment shares, coupons, stock, payment method kinds and who may review are decided in
WordPress. The SDK has no percentage or interest helpers, components compute none of those numbers,
and when Headpress does not send a value the interface shows nothing rather than a guess.

## What is in this repository

| Path | What it is |
| --- | --- |
| [`packages/headpress`](packages/headpress) | **`@meumouse.com/headpress`**, the published package (MIT). Its [README](packages/headpress/README.md) is the API reference |
| [`registry/`](registry) | shadcn/ui registry of storefront components (`registry.json`, sources in `headpress/`, build output in `public/r`) |
| [`apps/starter`](apps/starter) | `@meumouse.com/headpress-starter`, a Next.js 16 store wired with the SDK and the registry (private) |
| [`contract/`](contract) | Snapshot of the Headpress contract the SDK types are generated from (store config schema, commerce schema, routes) |
| [`scripts/`](scripts) | `contract-pull.mjs` (fetch the contract) and `codegen.mjs` (generate the types) |
| [`docs/`](docs) | [Guide for Brazilian stores (pt-BR)](docs/guia-pt-BR.md) and the [migration guide](docs/migration.md) |
| `.changeset/` | Pending release notes ([Changesets](https://github.com/changesets/changesets)) |
| `.github/workflows/` | `ci.yml` (checks on every push and pull request) and `release.yml` (versioning and staged npm publishing) |

## The SDK at a glance

One package, split by entry point so a store only ships what it imports. The core has **no runtime
dependencies** and runs in browsers, Node.js 20.19+, edge runtimes, Bun and Deno.

| Entry point | Contents |
| --- | --- |
| `@meumouse.com/headpress` | `createHeadpress()`: store config (ETag, stale fallback), capabilities, route map, SEO, catalog, cart, search, content, accounts, customer, reviews, checkout, payments; `Money`; typed errors; plugins |
| `@meumouse.com/headpress/server` | Secret key, forwarded shopper IP, `clientIp()`, `swr()` cache with memory and Redis stores |
| `@meumouse.com/headpress/webhooks` | Revalidation webhook: signature checks (Web Crypto), de-duplication, revalidation plans |
| `@meumouse.com/headpress/br` | CPF/CNPJ, CEP and ViaCEP, Brazilian phones, dates, Brazilian Market checkout fields |
| `@meumouse.com/headpress/analytics` | Cookie consent (Consent Mode v2), GA4 / Meta Pixel / Pinterest, Conversions API relay, attribution, purchases, abandoned carts |
| `@meumouse.com/headpress/controllers` | Framework-agnostic state: cart, search box, one-time code sign-in, review form, split builder, shipping quote, address form |
| `@meumouse.com/headpress/react` | `HeadpressProvider` and hooks over the controllers |
| `@meumouse.com/headpress/next` | Next.js glue safe anywhere: `nextCache()`, metadata, redirect and XML responses |
| `@meumouse.com/headpress/next/server` | Revalidation route, auth BFF (`createAuthHandler()`), request cookies |
| `@meumouse.com/headpress/messages/{pt-BR,en,es}` | Shopper-facing error texts |
| `@meumouse.com/headpress/testing` | A fake WordPress REST API and fixtures for store tests |

```ts
import { bffSession, cookieCartToken, createHeadpress } from "@meumouse.com/headpress";
import { ptBR } from "@meumouse.com/headpress/messages/pt-BR";

export const hp = createHeadpress({
  baseUrl: "https://wp.example.com",
  publishableKey: "hp_pk_…",
  session: bffSession(), // refresh token in an httpOnly cookie on your server
  cartToken: cookieCartToken(), // first-party hp_cart cookie
  messages: ptBR,
});

const page = await hp.catalog.list({ category: "aneis", perPage: 12 });
const cart = await hp.cart.addItem({ id: page.items[0].id });
```

Size budgets (brotli, enforced in CI): full client 25 kB, analytics 10 kB, controllers 10 kB,
webhooks 3 kB, `br` 2 kB.

## Compatibility

| | Supported |
| --- | --- |
| Headpress | 1.2+. **1.3** for price previews, split and shipping quotes, `commerce.policies`, `store.headpress_version` and route schemas |
| WooCommerce | 9.0+ (catalog, cart and checkout go through its Store API) |
| Node.js | 20.19+ (ESM only) |
| Next.js adapters | 15+ |
| React bindings | 18.2+ |

The store config contract is `schema_version` 1. The client warns once when Headpress sends a newer
schema or a version below `MIN_HEADPRESS_VERSION`.

Store-specific Headpress add-ons are typed by the store itself (declaration merging on
`ModuleConfigMap`) and wired through a plugin (`definePlugin()`) in the store's repository.

## Development

Requires Node.js 20.19+ and pnpm (the version is pinned in `packageManager`).

```bash
pnpm install
pnpm check                                   # typecheck, registry typecheck, tests, build, package lint, size limits
pnpm --filter @meumouse.com/headpress test:watch
```

| Command | What it does |
| --- | --- |
| `pnpm check` | Everything CI runs, in order |
| `pnpm build` / `pnpm test` / `pnpm typecheck` | Across the workspace |
| `pnpm lint:package` | `publint` and `@arethetypeswrong/cli` on the package |
| `pnpm size` | `size-limit` budgets |
| `pnpm codegen` / `pnpm codegen --check` | Generate the types from `contract/`, or fail when they are out of date (CI) |
| `pnpm contract:pull …` | Refresh `contract/` (below) |
| `pnpm registry:build` / `registry:typecheck` / `registry:lint` | Build, typecheck and lint the registry (lint uses the starter's ESLint install) |
| `pnpm changeset` | Describe a change for the next release |

Tests use Vitest with a fake `fetch` (`packages/headpress/test/helpers.ts`); React tests run in
happy-dom.

### Updating the contract

When Headpress changes its public contract, pull it and regenerate the types, then commit both:

```bash
# From a site over HTTP
pnpm contract:pull --url https://wp.example.com --plugin "/path/to/wp-content/plugins/headpress"

# Or from `wp headpress contract export --dir=<dir>` (Headpress 1.3+; also writes routes.json)
pnpm contract:pull --from <dir> --plugin "/path/to/wp-content/plugins/headpress"

pnpm codegen
```

Only Headpress **core** modules are typed here (`contract/core-modules.json`); add-on modules belong
to the stores that use them.

### The registry

Components live in `registry/headpress/*.tsx`. After a change: `pnpm registry:typecheck`,
`pnpm registry:lint`, then `pnpm registry:build` and commit `registry/public/r`. Stores install items
with `npx shadcn add <url>/r/<item>.json`; see the [registry README](registry/README.md).

### The starter

```bash
pnpm --filter @meumouse.com/headpress build
pnpm --filter @meumouse.com/headpress-starter dev    # http://localhost:3000
```

It needs a reachable Headpress site and its CORS allowing the starter's origin; see the
[starter README](apps/starter/README.md) for the environment variables and the page-by-page map.

## Releases and publishing

Versioning uses Changesets: every change to the package adds a file to `.changeset/` describing it
(`pnpm changeset`). The package is public (`publishConfig.access`) and released through npm
[staged publishing](https://docs.npmjs.com/staged-publishing): CI uploads each version with a
provenance attestation, and it only goes public after a maintainer approves it with 2FA.

1. Merge changes with their changesets into `main`.
2. `release.yml` opens (or updates) a **"chore: version packages"** pull request with the new
   version and changelog.
3. Merging that pull request runs `scripts/stage-publish.mjs`, which stages the version with
   `npm stage publish` through trusted publishing (OIDC, no token stored). It does nothing when the
   version is already on npm.
4. Approve the staged version on the package page on [npmjs.com](https://www.npmjs.com/package/@meumouse.com/headpress)
   or with `npm stage list` and `npm stage approve <id>`. Approval is only available after npm's
   malware scan finishes.

The trusted publisher on npm points at organization `meumouse`, repository `headpress-sdk-js`,
workflow `release.yml`, with the *npm stage publish* permission only, so CI can never publish
directly. A new trusted publisher configuration must be used by a successful run within two days,
or it expires and has to be recreated.

`0.x` releases may break the API in a minor version; breaking changes are flagged **Breaking** in the
changeset, and the changelog says which Headpress version a release needs.

## Conventions

Contributors and coding agents follow [AGENTS.md](AGENTS.md) (in Portuguese): commit messages in
English without attribution lines, English documentation, zero runtime dependencies, `Money` for
every amount, server-only code only in `/server` and `/next/server`, and one changeset per change.

## License

MIT © MeuMouse.com
