---
"@meumouse/headpress": minor
---

Catalog, cart, search and content: `hp.catalog` (Store API products with `Money`, stock and quantity rules, storefront paths and the server's price preview; variations, facets, categories, tags, attributes), `hp.cart` (Cart-Token bootstrap and renewal, carts carried by error answers, `subscribe()`), `hp.search` (suggestions, result pages with the `X-Headpress-*` headers, popular searches, the analytics beacon, `highlightSegments()`), `hp.content` (content by path, menus, previews) and `createRecentlyViewed()`. `requestCartToken()` in `/next` reads the shopper's Cart-Token from the request cookies. HTML entity decoding now covers Latin-1 names.
