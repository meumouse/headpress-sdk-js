"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { Product } from "@meumouse.com/headpress";
import { productEventParams } from "@meumouse.com/headpress/analytics";
import { useCart, useFormatError, useHeadpressValue } from "@meumouse.com/headpress/react";

import { HeadpressInstallments } from "@/components/headpress-installments";
import { HeadpressPrice } from "@/components/headpress-price";
import { HeadpressShippingCalculator } from "@/components/headpress-shipping-calculator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAnalytics } from "@/modules/analytics/analytics-provider";

/** Clamp a typed quantity to what the Store API accepts for this product (min, max, step). */
function clampQuantity(value: number, rules: Product["quantity"]): number {
  const step = rules.step || 1;
  let next = Number.isFinite(value) ? Math.round(value) : rules.min;
  next = Math.max(rules.min, next);
  if (rules.max !== null) next = Math.min(rules.max, next);
  // Snap to the step the Store API enforces (`multiple_of`).
  next = Math.max(rules.min, next - ((next - rules.min) % step));
  return next;
}

/**
 * Variation choice, quantity and add to cart, plus the per-product quotes from the server:
 * shipping (`hp.checkout.shippingQuote`) and installments (`hp.checkout.installments`).
 */
export function ProductPurchase({ product, variations }: { product: Product; variations: Product[] }) {
  const { tracker } = useAnalytics();
  const formatError = useFormatError();
  const [cartState, cart] = useCart();
  const cartPath = useHeadpressValue((hp) => hp.routes.path("cart"));
  const [variationId, setVariationId] = useState<number | null>(variations.length === 1 ? variations[0]!.id : null);
  const selected = useMemo(() => variations.find((entry) => entry.id === variationId) ?? null, [variations, variationId]);
  // What is being bought: the variation once chosen, else the product itself.
  const item = selected ?? product;
  const [typed, setQuantity] = useState(() => item.quantity.min);
  // Always within what the Store API accepts for the item being bought (rules differ per variation).
  const quantity = clampQuantity(typed, item.quantity);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    // Spread: the helpers return interfaces, which TypeScript will not match to the params index signature.
    tracker?.track("view_item", { ...productEventParams(product) });
  }, [tracker, product]);

  const needsVariation = product.type === "variable" && !selected;
  const purchasable = item.stock.purchasable && item.stock.inStock;
  const adding = cartState.pending.includes("new");

  async function addToCart() {
    setAdded(false);
    const next = await cart.addItem({ id: item.id, quantity });
    if (next) {
      setAdded(true);
      tracker?.track("add_to_cart", { ...productEventParams(item, { quantity }) });
    }
  }

  return (
    <div className="space-y-6">
      <HeadpressPrice product={item} size="lg" />

      {variations.length > 0 && (
        <div className="grid gap-1.5">
          <Label htmlFor="variation">Opção</Label>
          <select
            id="variation"
            value={variationId ?? ""}
            onChange={(event) => setVariationId(event.target.value ? Number(event.target.value) : null)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
          >
            <option value="">Escolha uma opção</option>
            {variations.map((variation) => (
              <option key={variation.id} value={variation.id} disabled={!variation.stock.inStock}>
                {variation.variationLabel || variation.name}
                {variation.stock.inStock ? "" : " — esgotado"}
              </option>
            ))}
          </select>
        </div>
      )}

      {item.stock.availability && <p className="text-sm text-muted-foreground">{item.stock.availability}</p>}

      <div className="flex items-end gap-3">
        {!item.quantity.soldIndividually && (
          <div className="grid gap-1.5">
            <Label htmlFor="quantity">Quantidade</Label>
            <Input
              id="quantity"
              type="number"
              className="w-24"
              min={item.quantity.min}
              max={item.quantity.max ?? undefined}
              step={item.quantity.step}
              value={typed}
              onChange={(event) => setQuantity(Number(event.target.value))}
              onBlur={() => setQuantity(quantity)}
            />
          </div>
        )}
        <Button size="lg" disabled={needsVariation || !purchasable || adding} onClick={addToCart}>
          {adding ? "Adicionando…" : needsVariation ? "Escolha uma opção" : purchasable ? "Adicionar ao carrinho" : "Indisponível"}
        </Button>
      </div>

      {cartState.error && (
        <p role="alert" className="text-sm text-destructive">
          {formatError(cartState.error, "cart")}
        </p>
      )}
      {added && cartPath && (
        <p className="text-sm">
          Produto adicionado.{" "}
          <Link href={cartPath} className="underline underline-offset-4">
            Ver carrinho
          </Link>
        </p>
      )}

      <HeadpressInstallments productId={product.id} price={item.price} />

      <HeadpressShippingCalculator productId={product.id} variationId={selected?.id} quantity={quantity} />
    </div>
  );
}
