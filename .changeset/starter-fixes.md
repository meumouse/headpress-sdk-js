---
"@meumouse/headpress": patch
---

Fixes found while building the starter: `createConsent().get()` returns the same object until the decision changes (snapshot readers such as `useSyncExternalStore` no longer loop); server error messages are HTML-decoded; catalog reads wait for the store config so storefront paths are never null on the first read; cart lines carry a storefront `path`; `routes.match()` reads query tokens (`order_received`'s `order_id` and `order_key`); `bffSession()` opens its BroadcastChannel only in browsers; `useCart()` fetches on mount only when a Cart-Token exists (option `load`); the analytics item helpers' results fit `track()` without a spread.
