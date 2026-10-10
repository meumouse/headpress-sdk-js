---
"@meumouse/headpress": patch
---

Fixes found while moving the first store onto the SDK: `createServerHeadpress({ clientIp })` forwards the shopper's IP on every call of a per-request client (resources and plugins included); home SEO heads carry the `path:/` tag and `seo.head()` accepts extra `cacheTags`; `redisCache({ clientKeyPrefix })` deletes by pattern through an ioredis `keyPrefix`; `nextCache()` drops `If-None-Match` from tagged reads so the Next.js Data Cache keeps one entry per URL. The README lists the codes the SDK raises itself.
