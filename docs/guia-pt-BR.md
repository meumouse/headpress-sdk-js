# Guia do `@meumouse/headpress` para lojas brasileiras

Este guia é para quem vai montar uma loja headless sobre o Headpress (WordPress + WooCommerce) com
o SDK. A referência completa da API está no [README do pacote](../packages/headpress/README.md), em
inglês.

## A regra que vale para tudo

**A loja mostra o que o servidor decidiu.** Preço, desconto do Pix, parcelas, frete, divisão do
pagamento, cupom, estoque e quem pode avaliar são decididos no WordPress. O SDK não tem funções de
porcentagem nem de juros, e os componentes não calculam nada disso. Se o Headpress não manda um
valor, a tela não mostra um número no lugar.

Na prática:

| Na tela | De onde vem |
| --- | --- |
| "R$ 179,91 no Pix" e "3x de R$ 66,63 sem juros" na vitrine | `product.pricePreview` (Headpress 1.3, módulo `installments` com o Parcelas Customizadas) |
| Tabela de parcelas | `hp.checkout.installments(productId)` |
| Frete na página do produto | `hp.checkout.shippingQuote()` (Headpress 1.3) |
| Barra de frete grátis | `cart.freeShipping` e `config.commerce.policies.free_shipping_threshold` |
| Valor de cada parte do pagamento dividido | `hp.checkout.quoteSplit()` (Headpress 1.3) |
| Tipo de cada forma de pagamento (Pix, cartão, boleto) | `method.kind`, enviado pelo servidor |
| Totais, descontos e taxas do carrinho | `cart.totals`, da Store API |

## Requisitos

- WordPress com WooCommerce e o Headpress **1.3 ou mais novo** (o SDK funciona com 1.2, sem a
  prévia de preço e sem as cotações).
- Node.js 20.19+ na loja.
- Para lojas brasileiras: Brazilian Market on WooCommerce (CPF, CNPJ, número, bairro) e, para
  parcelas e desconto por forma de pagamento, o Parcelas Customizadas.

## Começando

```bash
npm install @meumouse/headpress
```

```ts
// src/lib/headpress.ts
import { bffSession, cookieCartToken, createHeadpress } from "@meumouse/headpress";
import { ptBR } from "@meumouse/headpress/messages/pt-BR";
import { nextCache } from "@meumouse/headpress/next";

export const hp = createHeadpress({
  baseUrl: process.env.NEXT_PUBLIC_WP_URL!,
  publishableKey: process.env.NEXT_PUBLIC_HEADPRESS_PUBLISHABLE_KEY,
  session: bffSession({ basePath: "/api/auth" }), // refresh token em cookie httpOnly no seu servidor
  cartToken: cookieCartToken(), // cookie hp_cart, lido no navegador e no servidor
  messages: ptBR, // textos de erro em português
  plugins: [nextCache({ revalidate: 300 })],
});
```

O [starter](../apps/starter/README.md) é uma loja Next.js completa montada só com o SDK e os
componentes do registry. É o jeito mais rápido de começar.

## Campos brasileiros

```ts
import { brazilianMarketValues, isValidCpf, lookupCep, maskCep } from "@meumouse/headpress/br";

const endereco = await lookupCep("01310-100"); // ViaCEP
await hp.checkout.place({
  billingAddress,
  paymentMethod: "woo-mercado-pago-pix",
  fields: brazilianMarketValues({ document: "529.982.247-25", number: "1000", neighborhood: "Bela Vista" }),
});
```

`brazilianMarketValues()` aceita CPF (pessoa física) e CNPJ (pessoa jurídica, com razão social e
inscrição estadual). O tipo de pessoa é deduzido do documento.

## Pix e boleto

`order.instructions` (logo depois do pedido) e `hp.payments.summary(orderId, { key })` (na página
de pedido recebido) trazem o código copia e cola, a imagem do QR Code e a validade do Pix, ou o link
e a linha digitável do boleto, seja qual for o gateway (Mercado Pago, Asaas e outros). O componente
`headpress-pix-instructions` do registry mostra tudo isso com contagem regressiva.

Se o pagamento falhar, ofereça outra forma sem refazer o pedido:
`hp.checkout.retryPayment(orderId, { key, paymentMethod: "woo-mercado-pago-pix" })`.

## Login por WhatsApp

O login por código usa os canais de `config.modules.passwordless.channels`. O WhatsApp só aparece
quando o módulo Joinotify está ligado e o template aprovado; se o envio falhar, o Headpress responde
`headpress_channel_unavailable` com `fallback_channels: ["email"]` e o componente
`headpress-otp-login` oferece o e-mail.

## LGPD e consentimento

- Todo rastreamento começa negado. `createConsent()` guarda a escolha no cookie `hp_consent` e a
  versão do consentimento vem do WordPress: quando a loja muda a versão, o banner volta.
- O carrinho abandonado **exige** a escolha de marketing (`consent: { marketing }`): sem opt-in, nada
  de WhatsApp de recuperação.
- `recordConsent()` guarda a prova do consentimento no WordPress, quando o módulo está configurado
  para isso.

## Regras da sua loja

Regras que só a sua loja tem (um cupom especial, um formulário próprio, um add-on do Headpress)
entram por um plugin do SDK, dentro do repositório da loja:

```ts
import { definePlugin } from "@meumouse/headpress";

export const minhaLoja = definePlugin({
  name: "loja",
  setup: ({ request }) => ({
    orcamento: (dados: { nome: string; email: string }, captcha: string) =>
      request("/store/loja/orcamento", { body: dados, captcha, module: "loja_orcamento" }),
  }),
  messages: { "pt-BR": { loja_fora_do_prazo: "O prazo para pedir orçamento terminou." } },
});
```

Os tipos do config do seu add-on entram por declaration merging em `ModuleConfigMap`.

## Componentes prontos

O [registry](../registry/README.md) tem componentes shadcn para preço, busca, avaliações, login por
código, Pix, frete, parcelas, pagamento dividido, endereço brasileiro e o banner de cookies. Eles são
copiados para o seu projeto: o visual é seu.
