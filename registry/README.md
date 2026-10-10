# Headpress UI registry

A [shadcn/ui](https://ui.shadcn.com) registry of storefront components built on
[`@meumouse/headpress`](../packages/headpress). The components are copied into your project by the
shadcn CLI, so you own the code: restyle it, translate it, or change the markup.

They follow the SDK's golden rule: **the UI shows what the server decided.** Prices, Pix discounts,
installments, shipping, split amounts and who may review all come from Headpress. No component
computes a discount, divides a price into installments or guesses a shipping threshold. When a value
is missing, the line is hidden and the fix is to turn the feature on in Headpress.

## Installing an item

```bash
npx shadcn@latest add <registry-url>/r/headpress-price.json
```

`<registry-url>` is wherever `registry/public/r` is served. Straight from GitHub:

```bash
npx shadcn@latest add https://raw.githubusercontent.com/meumouse/headpress-sdk-js/main/registry/public/r/headpress-price.json
```

The CLI installs `@meumouse/headpress` (and `lucide-react` when the item uses icons), adds the shadcn
primitives the item needs (`button`, `dialog`, `select`…) and writes the component to your
`components` folder, e.g. `components/headpress-price.tsx`.

## Requirements

- A project already set up with shadcn/ui and Tailwind CSS (`npx shadcn@latest init`). The classes
  work with Tailwind 3.4 and 4.
- React 18.2+ and a client boundary: every component is a client component (`"use client"`).
- A `HeadpressProvider` above the components, with the store config from the server so the first
  render already knows which modules are on:

```tsx
"use client";
import { createHeadpress } from "@meumouse/headpress";
import { ptBR } from "@meumouse/headpress/messages/pt-BR";
import { HeadpressProvider } from "@meumouse/headpress/react";

const hp = createHeadpress({ baseUrl: process.env.NEXT_PUBLIC_HEADPRESS_URL!, locale: "pt-BR", messages: ptBR });

export function Providers({ config, children }) {
  return (
    <HeadpressProvider client={hp} initialConfig={config}>
      {children}
    </HeadpressProvider>
  );
}
```

Components that depend on a module render nothing (or a short notice) while the module is off in
`config.modules`, so it is safe to place them before the module is enabled.

## Items

| Item | What it does | Needs |
| --- | --- | --- |
| `headpress-price` | Price, regular price struck through while on sale, "a partir de" for variable products whose variations cost different amounts, and the Pix price and best installment line **only when `product.pricePreview` exists** | A `Product` from `hp.catalog`; Headpress price preview for the extra lines |
| `headpress-search-dialog` | Command-palette search: grouped suggestions (products with image/price, terms, posts), highlights, "did you mean", redirects, popular searches, keyboard navigation and empty/too-short/loading/error states | `search` module. Routing goes through `onNavigate(path)`; pass `resultsPath(query)` for Enter and "view all" |
| `headpress-product-reviews` | Average, distribution bars (clickable star filters), count, sorted and paginated list with photos/videos, verified badge, store reply and optimistic "helpful" votes | `reviews` module. Follows `show_verified_label`, `show_replies`, `show_avatars`, `helpful_enabled`, `helpful_guests` |
| `headpress-review-form` | Star rating, title and text with counters from the config limits, photo/video uploads with previews, progress and remove, field errors, captcha, approved vs pending success, eligibility answers | `reviews` module. Optional `getCaptcha(action)` (action from `captcha_action`) and `onSignInRequest` |
| `headpress-otp-login` | One-time code sign-in: channel choice from `passwordless.channels` (WhatsApp only when listed), phone mask, code cells sized by `code_length`, resend countdown, attempts left, fallback channel offer, registration step | `passwordless` module. `onSignedIn(result)`, optional `getCaptcha(action)` |
| `headpress-pix-instructions` | Pix QR code, copy-and-paste code with copy button, live countdown to `expiresAt` and expired state; bank slip link and barcode copy | A `PaymentInstructions` (`placed.instructions`, `payment.instructions`…) |
| `headpress-shipping-calculator` | Masked CEP, rates with cost and delivery window, free-shipping progress only from the server's `freeShipping` | Headpress 1.3+ (`hp.checkout.shippingQuote`) |
| `headpress-installments` | Installment table in a dialog, best plan without and with interest highlighted | `installments` module (`hp.checkout.installments`) |
| `headpress-split-payment-picker` | Split the order total between methods: add/remove parts, amount inputs, local problems and the server's quote (discount and charge per part) | `split_payments` module with `checkout_enabled`. Place the order with `paymentMethod: gateway_id` and `splitLegs` from `onChange` |
| `headpress-address-form` | Brazilian address: CEP auto-fill, street, number, complement, neighborhood, city, UF select, CPF/CNPJ and phone masks, field errors; `onSubmit(values, checkoutFields)` | Nothing beyond the SDK (`/br` helpers, ViaCEP). Follows `address_book.require_number` / `require_neighborhood` when present |

## Customizing

- **Text.** Every user-facing string comes from the `labels` prop. All keys are optional and default
  to Brazilian Portuguese; strings with values are functions:

  ```tsx
  <HeadpressPrice
    product={product}
    labels={{
      from: "from",
      pix: (price) => `${price} with Pix`,
      installments: (count, amount, free) => `or ${count}x ${amount}${free ? " interest-free" : ""}`,
    }}
  />
  ```

- **Errors** come from the SDK's dictionaries through `useFormatError()`, so they follow the client's
  locale and any messages your plugins add.
- **Money** is printed with `useFormatMoney()`, in the client's locale.
- **Styling.** Each component takes `className` for its root, and the markup uses the shadcn theme
  tokens (`bg-card`, `text-muted-foreground`, `border`…), so your theme applies. Beyond that, edit the
  copied file.

## Developing the registry

```bash
pnpm registry:typecheck   # tsc against the SDK sources, with zero errors
pnpm registry:lint        # eslint-config-next 16 (React Compiler rules), with zero warnings
pnpm registry:build       # shadcn build → registry/public/r/*.json
```

- `registry/registry.json` lists the items; the sources are in `registry/headpress/`.
- `registry/ui/` and `registry/lib/` hold copies of the official shadcn/ui primitives (new-york-v4)
  and `cn`, only so the components typecheck here. They are not registry items; installs use the
  primitives from the shadcn registry.
- `registry/tsconfig.json` maps `@/components/ui/*`, `@/lib/utils` and `@meumouse/headpress/*` (to the
  package sources), so the typecheck follows the SDK as it changes.
- `registry/eslint.config.mjs` reuses the `eslint-config-next` installed for `apps/starter`, so the
  components pass the same lint a fresh Next 16 store runs on them. Do not silence its
  `react-hooks/*` rules: derive state while rendering, read external state with
  `useSyncExternalStore` and set state only in event handlers or async callbacks.
- Commit `registry/public/r` after `registry:build`: it is what the CLI downloads.
