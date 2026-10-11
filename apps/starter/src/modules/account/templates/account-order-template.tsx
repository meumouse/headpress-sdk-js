"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { OrderDetail } from "@meumouse.com/headpress";
import { useCustomer, useFormatError, useFormatMoney, useHeadpress } from "@meumouse.com/headpress/react";

/** One of the signed-in customer's orders (`account_order` route). */
export function AccountOrderTemplate({ orderId }: { orderId: number }) {
  const hp = useHeadpress();
  const formatMoney = useFormatMoney();
  const formatError = useFormatError();
  const { customer, status } = useCustomer();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const account = hp.routes.path("account");

  useEffect(() => {
    if (!customer) return;
    let cancelled = false;
    hp.customer.orders
      .get(orderId)
      .then((detail) => {
        if (!cancelled) setOrder(detail);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(formatError(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [hp, customer, orderId, formatError]);

  if (status === "loading") return <p className="text-muted-foreground">Carregando…</p>;
  if (!customer) {
    return (
      <p className="text-muted-foreground">
        Entre na sua conta para ver este pedido.{" "}
        {account && (
          <Link href={account} className="underline underline-offset-4">
            Entrar
          </Link>
        )}
      </p>
    );
  }
  if (error) return <p className="text-destructive">{error}</p>;
  if (!order) return <p className="text-muted-foreground">Carregando pedido…</p>;

  const rows: [string, string][] = [
    ["Subtotal", formatMoney(order.totals.subtotal)],
    ...(order.totals.discount.amount > 0 ? ([["Descontos", `−${formatMoney(order.totals.discount)}`]] as [string, string][]) : []),
    ["Frete", formatMoney(order.totals.shipping)],
    ["Total", formatMoney(order.totals.total)],
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {account && (
        <Link href={account} className="text-sm text-muted-foreground hover:text-foreground">
          ← Meus pedidos
        </Link>
      )}
      <h1 className="text-2xl font-semibold tracking-tight">
        Pedido #{order.number} <span className="text-base font-normal text-muted-foreground">· {order.status_label}</span>
      </h1>
      <ul className="divide-y rounded-lg border text-sm">
        {order.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-4 p-3">
            <span>
              {item.quantity}× {item.url ? <Link href={item.url}>{item.name}</Link> : item.name}
            </span>
            <span>{formatMoney(item.total)}</span>
          </li>
        ))}
      </ul>
      <dl className="space-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">Pagamento: {order.payment_method_title}</p>
    </div>
  );
}
