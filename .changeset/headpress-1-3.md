---
"@meumouse/headpress": minor
---

Headpress 1.3 contract: the price preview is read from `extensions.headpress.installments.price_preview` (search results carry it too, as `prices.preview`), `config.commerce.policies` (free-shipping threshold, handling and transit days, return window, minimum order) is typed, `store.headpress_version` is read and a warning fires below `MIN_HEADPRESS_VERSION` (`compareVersions()` is exported). `contract-pull` reads `wp headpress contract export` output, including `routes.json`.
