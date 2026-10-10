---
"@meumouse/headpress": minor
---

Checkout and payments: `hp.checkout` (payment methods with the server's kind, installments and discount rule — never guessed; placing orders with `extensions.headpress` built from plain options; `retryPayment()` without a new order; `quoteSplit()`, `shippingQuote()` and `installments()` from the server), `hp.payments` (order ledgers, balance payments, payment links), `paymentInstructions()` for Pix codes and bank slips across gateways, payment adapters (`definePaymentAdapter()`, `resolvePaymentData()`), and the `@meumouse/headpress/br` entry (CPF/CNPJ, CEP with ViaCEP, phones, dates, Brazilian Market fields). Split quotes, shipping quotes and price previews need Headpress 1.3.
