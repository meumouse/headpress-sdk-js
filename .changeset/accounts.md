---
"@meumouse/headpress": minor
---

Accounts: `hp.auth` (password, one-time codes by WhatsApp or e-mail, Google, password reset, restore, logout) storing tokens and the customer's Cart-Token; `bffSession()` for browsers whose refresh token lives in an httpOnly cookie (cross-tab locks and broadcasts, a retry after concurrent rotations); `hp.customer` (profile, password change with token rotation, orders as `Money`, downloads, login phone, e-mail verification, Google link, wishlist, addresses, saved payment methods, own reviews); `hp.reviews` (lists, summaries, media, eligibility, votes with a guest voter id, submissions and uploads). **Breaking:** `@meumouse/headpress/next` is now safe to import anywhere; `createRevalidateRoute()` and `requestCartToken()` moved to the new `@meumouse/headpress/next/server`, which also has `createAuthHandler()`.
