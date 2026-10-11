"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";

import type { Cart, CartItem, Money } from "@meumouse.com/headpress";
import { cartEventParams } from "@meumouse.com/headpress/analytics";
import { useCart, useFormatError, useFormatMoney, useHeadpressValue, useStoreConfig } from "@meumouse.com/headpress/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useAnalytics } from "@/modules/analytics/analytics-provider";

function LineQuantity({ line, busy, onChange }: { line: CartItem; busy: boolean; onChange: (quantity: number) => void }) {
  const limits = line.quantityLimits;
  // Remounted (key) whenever the server answers a new quantity, so the input starts from it.
  const [value, setValue] = useState(String(line.quantity));

  if (!limits.editable) return <span className="text-sm">{line.quantity}</span>;
  const commit = () => {
    const next = Number.parseInt(value, 10);
    if (!Number.isInteger(next) || next === line.quantity) return setValue(String(line.quantity));
    // The Store API enforces min/max/step; the input only mirrors them.
    onChange(next);
  };
  return (
    <Input
      type="number"
      aria-label={`Quantidade de ${line.name}`}
      className="w-20"
      min={limits.min}
      max={limits.max ?? undefined}
      step={limits.step}
      value={value}
      disabled={busy}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === "Enter" && commit()}
    />
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "flex justify-between text-base font-semibold" : "flex justify-between text-sm"}>
      <span className={strong ? undefined : "text-muted-foreground"}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/**
 * The cart page. Every number is the Store API's: line totals, discounts, fees, shipping and the
 * total; the free-shipping progress is Headpress's (`cart.freeShipping`). The server-rendered cart
 * shows until the browser's cart controller has loaded.
 */
export function CartTemplate({ initialCart }: { initialCart: Cart | null }) {
  const config = useStoreConfig();
  const formatMoney = useFormatMoney();
  const formatError = useFormatError();
  const { tracker } = useAnalytics();
  const [state, actions] = useCart();
  const [coupon, setCoupon] = useState("");
  const links = useHeadpressValue((hp) => ({ checkout: hp.routes.path("checkout"), shop: hp.routes.path("shop") ?? "/" }), [config?.version]);

  const cart = state.cart ?? initialCart;
  const viewed = useRef(false);
  useEffect(() => {
    if (!tracker || !state.cart || viewed.current) return;
    viewed.current = true;
    tracker.track("view_cart", { ...cartEventParams(state.cart) });
  }, [tracker, state.cart]);

  if (!cart && (state.status === "loading" || state.status === "idle")) {
    return <p className="text-muted-foreground">Carregando o carrinho…</p>;
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="space-y-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Seu carrinho está vazio</h1>
        <Button asChild>
          <Link href={links.shop}>Continuar comprando</Link>
        </Button>
      </div>
    );
  }

  const money = (value: Money) => formatMoney(value);
  const free = cart.freeShipping;
  const freeProgress =
    free && free.threshold.amount > 0 ? Math.min(100, Math.max(0, (free.subtotal.amount / free.threshold.amount) * 100)) : null;
  const couponsEnabled = config?.commerce?.checkout.coupons !== false;

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Carrinho</h1>

        {free && (
          <div className="space-y-2 rounded-lg border p-4">
            <p className="text-sm">
              {free.qualifies ? "Você ganhou frete grátis!" : `Faltam ${money(free.remaining)} para frete grátis.`}
            </p>
            {freeProgress !== null && <Progress value={freeProgress} aria-hidden="true" />}
          </div>
        )}

        <ul className="divide-y rounded-lg border">
          {cart.items.map((line) => {
            const busy = state.pending.includes(line.key);
            const image = line.images[0];
            return (
              <li key={line.key} className="flex gap-4 p-4" aria-busy={busy}>
                <div className="size-20 shrink-0 overflow-hidden rounded-md bg-muted">
                  {image && <img src={image.thumbnail || image.src} alt={image.alt || line.name} className="size-full object-cover" />}
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex justify-between gap-4">
                    <div>
                      <p className="font-medium">{line.name}</p>
                      {[...line.variation.map((entry) => ({ name: entry.attribute, value: entry.value })), ...line.itemData].map((entry) => (
                        <p key={`${entry.name}-${entry.value}`} className="text-xs text-muted-foreground">
                          {entry.name}: {entry.value}
                        </p>
                      ))}
                    </div>
                    <div className="text-right text-sm">
                      {line.subtotal.amount !== line.total.amount && (
                        <p className="text-muted-foreground line-through">{money(line.subtotal)}</p>
                      )}
                      <p className="font-medium">{money(line.total)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <LineQuantity key={line.quantity} line={line} busy={busy} onChange={(quantity) => void actions.updateItem(line.key, quantity)} />
                    <span className="text-xs text-muted-foreground">{money(line.unitPrice)} cada</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto"
                      aria-label={`Remover ${line.name}`}
                      disabled={busy}
                      onClick={async () => {
                        const next = await actions.removeItem(line.key);
                        if (next) tracker?.track("remove_from_cart", { ...cartEventParams({ ...cart, items: [line] }) });
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {formatError(state.error, "cart")}
          </p>
        )}
        {cart.errors.map((error) => (
          <p key={error.code} role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ))}
      </section>

      <aside className="h-fit space-y-4 rounded-lg border p-5">
        <h2 className="font-semibold">Resumo</h2>

        {couponsEnabled && (
          <form
            className="space-y-2"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!coupon.trim()) return;
              const next = await actions.applyCoupon(coupon);
              if (next) setCoupon("");
            }}
          >
            <Label htmlFor="coupon">Cupom de desconto</Label>
            <div className="flex gap-2">
              <Input id="coupon" value={coupon} onChange={(event) => setCoupon(event.target.value)} autoComplete="off" />
              <Button type="submit" variant="secondary" disabled={state.pending.includes("coupon")}>
                Aplicar
              </Button>
            </div>
          </form>
        )}
        {cart.coupons.map((entry) => (
          <div key={entry.code} className="flex items-center justify-between text-sm">
            <span>
              Cupom <strong className="uppercase">{entry.code}</strong> (−{money(entry.discount)})
            </span>
            <Button variant="link" size="sm" onClick={() => void actions.removeCoupon(entry.code)}>
              Remover
            </Button>
          </div>
        ))}

        <Separator />
        <div className="space-y-2">
          <Row label="Subtotal" value={money(cart.totals.subtotal)} />
          {cart.totals.discount.amount > 0 && <Row label="Descontos" value={`−${money(cart.totals.discount)}`} />}
          {cart.fees.map((fee) => (
            <Row key={fee.id} label={fee.name} value={money(fee.total)} />
          ))}
          {cart.needsShipping && (
            <Row label="Frete" value={cart.totals.shipping === null ? "Calculado no checkout" : money(cart.totals.shipping)} />
          )}
          {cart.totals.tax.amount > 0 && <Row label="Impostos" value={money(cart.totals.tax)} />}
        </div>
        <Separator />
        <Row label="Total" value={money(cart.totals.total)} strong />

        {links.checkout && (
          <Button className="w-full" size="lg" asChild>
            <Link href={links.checkout}>Finalizar compra</Link>
          </Button>
        )}
      </aside>
    </div>
  );
}
