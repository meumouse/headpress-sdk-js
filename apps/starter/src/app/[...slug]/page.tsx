import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { seoMetadata } from "@meumouse/headpress/next";

import { hp } from "@/lib/headpress";
import { createRequestHeadpress } from "@/lib/headpress-server";
import { resolvePath, routeQueryTokens, type Resolved } from "@/lib/data/resolve";
import { AccountOrderTemplate } from "@/modules/account/templates/account-order-template";
import { AccountTemplate } from "@/modules/account/templates/account-template";
import { CartTemplate } from "@/modules/cart/templates/cart-template";
import { CatalogTemplate } from "@/modules/catalog/templates/catalog-template";
import { CheckoutTemplate } from "@/modules/checkout/templates/checkout-template";
import { OrderReceivedTemplate } from "@/modules/checkout/templates/order-received-template";
import { ContentTemplate } from "@/modules/content/templates/content-template";
import { ProductTemplate } from "@/modules/products/templates/product-template";
import { ReviewTemplate } from "@/modules/products/templates/review-template";

type Params = Promise<{ slug: string[] }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** `/a/b` from the segments, keeping WordPress's percent-encoded slugs as they are. */
function pathOf(slug: string[]): string {
  return `/${slug.join("/")}`;
}

/** Pages that only make sense for one shopper: never indexed. */
const PRIVATE: ReadonlySet<Resolved["kind"]> = new Set(["cart", "checkout", "order_received", "account", "account_order", "product_review"]);

const TITLES: Partial<Record<Resolved["kind"], string>> = {
  cart: "Carrinho",
  checkout: "Finalizar compra",
  order_received: "Pedido recebido",
  account: "Minha conta",
  account_order: "Pedido",
  shop: "Loja",
};

function fallbackTitle(resolved: Resolved): string | undefined {
  switch (resolved.kind) {
    case "product":
    case "product_review":
      return resolved.product.name;
    case "term":
      return resolved.term.name;
    case "content":
      return resolved.content.post?.title;
    default:
      return TITLES[resolved.kind];
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const path = pathOf((await params).slug);
  const resolved = await resolvePath(path);
  if (!resolved) return { title: "Página não encontrada", robots: { index: false } };
  const fallback: Metadata = { title: fallbackTitle(resolved) };
  if (PRIVATE.has(resolved.kind)) return { ...fallback, robots: { index: false, follow: false } };
  // The head Headpress publishes for this storefront path (title, canonical, Open Graph, robots…).
  const metadata = await seoMetadata(hp, { path }, fallback);
  // The SEO plugin's title already carries the site name: keep it out of the layout's title template.
  if (typeof metadata.title === "string" && metadata.title !== fallback.title) metadata.title = { absolute: metadata.title };
  return metadata;
}

export default async function StorefrontPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const path = pathOf((await params).slug);
  const resolved = await resolvePath(path);
  if (!resolved) notFound();

  switch (resolved.kind) {
    case "product":
      return <ProductTemplate product={resolved.product} variations={resolved.variations} />;

    case "product_review": {
      const { id, name, path: productPath } = resolved.product;
      return <ReviewTemplate product={{ id, name, path: productPath }} />;
    }

    case "term":
      return (
        <CatalogTemplate
          title={resolved.term.name}
          description={resolved.term.description}
          base={resolved.taxonomy === "product_cat" ? { category: resolved.term.id } : { tag: resolved.term.id }}
          path={path}
          searchParams={await searchParams}
        />
      );

    case "shop":
      return <CatalogTemplate title="Loja" base={{}} path={path} searchParams={await searchParams} />;

    case "content":
      return <ContentTemplate content={resolved.content} fallbackTitle={fallbackTitle(resolved)} />;

    case "cart": {
      // Server-render the shopper's cart when they already have one (Cart-Token cookie); a guest
      // without one gets no cart session opened on their behalf.
      const server = await createRequestHeadpress();
      const initialCart = server.cartToken?.get() ? await server.cart.get().catch(() => null) : null;
      return <CartTemplate initialCart={initialCart} />;
    }

    case "checkout":
      return <CheckoutTemplate />;

    case "order_received": {
      const tokens = { ...resolved.match.tokens, ...routeQueryTokens(hp.routes.pattern("order_received"), await searchParams) };
      const orderId = Number(tokens.order_id);
      if (!Number.isInteger(orderId) || orderId <= 0 || !tokens.order_key) notFound();
      return <OrderReceivedTemplate orderId={orderId} orderKey={tokens.order_key} />;
    }

    case "account":
      return <AccountTemplate />;

    case "account_order":
      return <AccountOrderTemplate orderId={resolved.orderId} />;
  }
}
