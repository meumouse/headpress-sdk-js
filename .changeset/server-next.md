---
"@meumouse/headpress": minor
---

SEO, webhooks, server cache and Next.js: `hp.seo` (heads, redirect rules, sitemaps) with `resolveRedirect()` (Rank Math semantics), `createRedirectResolver()` and sitemap XML renderers; `@meumouse/headpress/webhooks` (signature verification with Web Crypto, delivery de-duplication, revalidation plans, a Fetch API handler); `swr()`, `memoryCache()` and `redisCache()` in `/server`; and `@meumouse/headpress/next` with the `nextCache()` plugin, `createRevalidateRoute()`, `toNextMetadata()`/`seoMetadata()`, `jsonLdScripts()`, `redirectResponse()` and `xmlResponse()`. Requests take `cacheTags` and `revalidate` for framework caches.
