# @meumouse/headpress

Typed, framework-agnostic client for [Headpress](https://meumouse.com), the headless commerce engine
for WordPress and WooCommerce.

- **One client for the whole contract**: Headpress (`headpress/v1`) and the WooCommerce Store API
  (`wc/store/v1`), with the right headers on each call and nothing more.
- **Runs anywhere**: browsers, Node.js 20.19+, edge runtimes, Bun and Deno. No runtime dependencies.
- **The server decides, the SDK shows**: prices, discounts, installments, shipping and eligibility
  come from Headpress. The SDK never makes up a number.
- **Extensible**: a store adapts it to its own Headpress add-ons with plugins, without forking.

> Status: `0.x`, under active development. The core (client, config, routes, errors, money,
> plugins, server entry) is in place; catalog, cart, checkout, account and the React/Next.js
> adapters land phase by phase.

## Install

```bash
npm install @meumouse/headpress
```

## Quick start

```ts
import { cookieCartToken, createHeadpress } from "@meumouse/headpress";
import { ptBR } from "@meumouse/headpress/messages/pt-BR";

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
import { isHeadpressError } from "@meumouse/headpress";

try {
  await hp.request("/store/auth/otp/verify", { body: { challenge_id, code } });
} catch (error) {
  if (isHeadpressError(error, "headpress_otp_invalid")) error.data.attempts_left; // typed
  showToast(hp.formatError(error, "login")); // "<code>@login" entries win over "<code>"
}
```

Dictionaries ship for `pt-BR`, `en` and `es`; pass your own after them to override entries.

## Money

Amounts are integers in minor units, in one `Money` shape whatever the source:

```ts
import { formatMoney, moneyFromDecimal, moneyFromMinor } from "@meumouse/headpress";

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
import { createHeadpress, definePlugin } from "@meumouse/headpress";

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
declare module "@meumouse/headpress" {
  interface ModuleConfigMap {
    cm_store: { enabled: true; welcome_coupon: { enabled: boolean; percent: number } };
  }
  interface ErrorDataMap {
    cm_invalid_cpf: { field?: string };
  }
}
```

## Server

`@meumouse/headpress/server` adds what must never reach a browser: the secret key for Headpress
`server/*` routes, and the shopper's IP forwarded for rate limiting. Bundlers resolve it to a stub
that throws in browser builds.

```ts
import { clientIp, createServerHeadpress } from "@meumouse/headpress/server";

const hp = createServerHeadpress({ baseUrl, secretKey: process.env.HEADPRESS_SECRET_KEY });

await hp.request("/server/revalidate", { secret: true, body: { tags: ["product:list"] } });
await hp.request("/store/auth/login", {
  body: { login, password },
  clientIp: clientIp(request.headers, { cloudflare: true }), // rightmost untrusted X-Forwarded-For hop
});
```

## Compatibility

| @meumouse/headpress | Headpress | Node.js |
| --- | --- | --- |
| 0.x | 1.2+ | 20.19+ |

ESM only. The store config contract is `schema_version` 1; a newer version triggers a warning.

## License

MIT © MeuMouse.com
