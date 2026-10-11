# AGENTS.md — headpress-sdk-js

SDK npm **`@meumouse.com/headpress`** (público, MIT): cliente tipado do Headpress para lojas headless.
O plano completo, com as decisões D1–D10, as brechas B1–B26 e os pré-requisitos H1–H15 no Headpress,
está em `../PLANO-SDK-HEADPRESS-2026-10-10.md`. A loja da Camila Maehler é a primeira a usar o SDK e
serve de referência.

## Regra de ouro

**O SDK mostra o que o servidor decidiu.** Preço, desconto, parcelas, frete, cupom, estoque e quem
pode avaliar são decididos no WordPress. Se o Headpress não informa um valor, o SDK não inventa um.
Por isso o SDK **não tem** helpers de porcentagem, juros ou desconto. Quando faltar um dado do
servidor, a saída é pedir o item ao Headpress (lista H1–H15 do plano), não calcular no cliente.

## Estrutura

| Caminho | O que é |
| --- | --- |
| `packages/headpress/src/` | Código do pacote. Uma entrada por subpath do `exports` |
| `packages/headpress/src/generated/` | Tipos gerados do contrato. **Não editar à mão** |
| `packages/headpress/src/messages/` | Textos de erro por idioma. Os três dicionários têm as mesmas chaves (há teste) |
| `packages/headpress/src/server/` | Entrada `/server`. `browser.ts` é o stub que o bundler usa no navegador |
| `contract/` | Retrato do contrato do Headpress e lista dos módulos do núcleo |
| `scripts/` | `contract-pull.mjs` (baixa o contrato) e `codegen.mjs` (gera os tipos) |
| `registry/` | Componentes shadcn (`headpress/*.tsx`), o build em `public/r` e primitivas só para typecheck (`ui/`) |

## Comandos

```bash
pnpm install
pnpm check                      # typecheck + testes + build + publint/attw + size-limit
pnpm --filter @meumouse.com/headpress test:watch
pnpm contract:pull --url http://headpress.local --plugin "<pasta do plugin headpress>"
pnpm codegen                    # depois de mudar o contrato
pnpm changeset                  # toda mudança no pacote ganha um changeset
```

## Regras

- **Mensagens de commit em inglês**, sem `Co-Authored-By:` nem menção a IA, como em todos os
  repositórios da pasta.
- **Documentação em inglês** (decisão D4): código, comentários, README e CHANGELOG do pacote, porque
  o público é o npm. É exceção à regra da raiz, que pede pt-BR. Guias para clientes brasileiros
  ficam em pt-BR.
- **Tamanho:** o cliente completo (todos os domínios) tem orçamento de 25 kB brotli; `/webhooks` e `/br`
  têm os seus. O `size-limit` falha o CI acima disso.
- **Zero dependências em runtime.** Usar só APIs da plataforma (`fetch`, `URL`, `AbortController`,
  `Intl`, Web Crypto). Dependências só em `devDependencies`.
- **ESM only, imports com `.js`** (`moduleResolution: NodeNext`).
- **O que é só de servidor nunca chega ao navegador.** Chave secreta e IP repassado ficam em
  `/server`, que tem stub para o navegador. O núcleo não pode importar nada de `/server`.
- **GET público vai sem Bearer** (`auth: "none"` é o padrão): o Headpress desliga o cache quando há
  um cliente logado.
- **Dinheiro sempre em `Money`** (inteiro em unidades mínimas). Nada de float em regra.
- **Formato dos tipos:** leituras montadas a partir da Store API (`Product`, `Cart`) são camelCase;
  payloads de conta do Headpress (cliente, pedido, endereço, avaliação) mantêm as chaves do contrato,
  porque add-ons acrescentam campos e alguns voltam para o servidor como estão — só o dinheiro vira `Money`.
- **Rota ausente em `config.routes` é rota desligada:** os helpers devolvem `null`, nunca um padrão
  inventado.
- **Contrato:** quando o Headpress mudar o `/store/config`, rode `contract:pull` + `codegen` e
  comite os dois. O CI falha se o gerado não bater com `contract/`.
- **Módulos de add-on** (`cm_*`, `precheckout`, `asaas`…) não entram no núcleo. A loja os tipa
  por declaration merging em `ModuleConfigMap` e os implementa num plugin próprio (decisão D10:
  o plugin `cm` é só da loja).
- **Compatibilidade:** a API pública segue semver. Enquanto estiver em `0.x`, mudança que quebra
  sobe o minor e vai no changeset como **Breaking**. O changelog diz qual versão mínima do
  Headpress passa a ser necessária.
- **Publicação só pelo CI, em stage:** o `release.yml` roda `scripts/stage-publish.mjs` (`npm stage publish`
  com proveniência) e a versão só fica pública depois de aprovada com 2FA no npmjs.com. O trusted
  publisher do npm só permite stage. Não rodar `npm publish` na máquina local.
- **Testes** com Vitest e um `fetch` falso (`test/helpers.ts`). Todo comportamento do transporte
  (cabeçalhos, sessão, Cart-Token, erros) tem teste.

## Fases

Ver §12 do plano. Situação:

- [x] **F1 — núcleo:** cliente, transporte, config com ETag, capacidades, mapa de rotas, erros e
  mensagens, `Money`, sessão e Cart-Token, plugins, `/server`.
- [x] **F2 — servidor e Next:** `hp.seo`, `/webhooks`, cache `swr()` no `/server`, `/next`
  (`nextCache`, rota de revalidação, metadados, redirects, XML).
- [x] **F3 — catálogo, carrinho e busca:** `hp.catalog` (Store API, facetas, variações),
  `hp.cart` (renovação do Cart-Token, assinatura), `hp.search`, `hp.content`, vistos recentemente,
  `requestCartToken()` no `/next`.
- [x] **F4 — conta:** `hp.auth` (senha, OTP WhatsApp/e-mail, Google, reset, logout), `bffSession()`,
  `createAuthHandler()` no `/next/server`, `hp.customer` (perfil, senha, pedidos, telefone, e-mail,
  Google, lista de desejos, endereços, cartões, avaliações) e `hp.reviews`. `/next` foi dividido:
  `/next` (seguro em qualquer contexto) e `/next/server`.
- [x] **F5 — checkout e pagamento:** `hp.checkout` (formas de pagamento com `kind` do servidor,
  pedido com `extensions.headpress`, nova tentativa, simulação do split, cotação de frete, parcelas),
  `hp.payments` (livro, saldo, links), instruções de Pix/boleto, adaptadores de gateway, `/br`.
- [x] **F6 — marketing e analytics:** `/analytics` (consentimento com Consent Mode v2, eventos canônicos,
  provedores GA4/Meta/Pinterest, relay da Conversions API, `purchase_<id>` único, atribuição,
  ids do navegador, carrinho abandonado com opt-in obrigatório, recuperação do carrinho).
- [x] **F7 — controladores, React e registry:** `/controllers` (carrinho, busca, OTP, avaliação, split,
  frete, endereço BR), `/react` (provider e hooks), registry shadcn em `registry/` (11 itens; build com
  `pnpm registry:build`, typecheck no `pnpm check`).
- [ ] **F8 — 1.0**
