"use client";

import Link from "next/link";

import type { Product } from "@meumouse.com/headpress";
import { useHeadpressValue } from "@meumouse.com/headpress/react";

import { HeadpressReviewForm } from "@/components/headpress-review-form";

/** The store's `product_review` route: the registry review form for one product. */
export function ReviewTemplate({ product }: { product: Pick<Product, "id" | "name" | "path"> }) {
  const accountPath = useHeadpressValue((hp) => hp.routes.path("account"));
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">Avaliar</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {product.path ? <Link href={product.path}>{product.name}</Link> : product.name}
        </h1>
      </header>
      <HeadpressReviewForm
        productId={product.id}
        onSignInRequest={accountPath ? () => window.location.assign(accountPath) : undefined}
      />
    </div>
  );
}
