"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { OrderPayments, PaymentInstructions } from "@meumouse/headpress";
import { trackPurchase } from "@meumouse/headpress/analytics";
import { useCapability, useFormatError, useFormatMoney, useHeadpress } from "@meumouse/headpress/react";

import { HeadpressPixInstructions } from "@/components/headpress-pix-instructions";
import { useAnalytics } from "@/modules/analytics/analytics-provider";

import { PLACED_KEY } from "./checkout-template";

const POLL_MS = 5000;

const PAID_STATES = new Set(["paid", "overpaid"]);

const noSubscription = () => () => undefined;

function readPlaced(orderId: number): string | null {
  try {
    return sessionStorage.getItem(PLACED_KEY(orderId));
  } catch {
    return null;
  }
}

function pixStatus(status: string): "pending" | "paid" | "failed" | undefined {
  if (status === "pending" || status === "paid") return status;
  if (status === "failed" || status === "expired" || status === "cancelled") return "failed";
  return undefined;
}

/**
 * The order-received page. It reads the order's payment ledger (`hp.payments.summary`, with the order
 * key from the URL) and polls it while a payment is pending, so a Pix paid on the phone turns into
 * "paid" here. Whether the order is paid is the server's answer (`state`); only then does the
 * purchase go to the tracker (`trackPurchase`, once per order per browser).
 */
export function OrderReceivedTemplate({ orderId, orderKey }: { orderId: number; orderKey: string }) {
  const hp = useHeadpress();
  const ledgerOn = Boolean(useCapability("split_payments"));
  const formatMoney = useFormatMoney();
  const formatError = useFormatError();
  const { tracker } = useAnalytics();
  const [summary, setSummary] = useState<OrderPayments | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  // What checkout() answered, for stores without the ledger (`split_payments` off). Browser only.
  const placedRaw = useSyncExternalStore(noSubscription, () => readPlaced(orderId), () => null);
  const placed = useMemo(() => {
    try {
      return placedRaw ? (JSON.parse(placedRaw) as { instructions: PaymentInstructions | null; status: string }) : null;
    } catch {
      return null;
    }
  }, [placedRaw]);

  useEffect(() => {
    if (!ledgerOn) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const next = await hp.payments.summary(orderId, { key: orderKey });
        if (cancelled) return;
        if (!next) {
          setMissing(true);
          return;
        }
        setSummary(next);
        setError(null);
        // Keep asking while something is still waiting to be paid.
        if (!PAID_STATES.has(next.state) && next.payments.some((payment) => payment.status === "pending")) {
          timer = setTimeout(load, POLL_MS);
        }
      } catch (reason) {
        if (cancelled) return;
        setError(formatError(reason, "order"));
        timer = setTimeout(load, POLL_MS * 2);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hp, ledgerOn, orderId, orderKey, formatError]);

  const paid = summary ? PAID_STATES.has(summary.state) : false;

  useEffect(() => {
    if (paid && tracker) void trackPurchase(hp, tracker, { orderId, key: orderKey });
  }, [paid, tracker, hp, orderId, orderKey]);

  if (missing) {
    return <p className="py-16 text-center text-muted-foreground">Não encontramos este pedido.</p>;
  }

  const pending = summary?.payments.filter((payment) => payment.status === "pending" && payment.instructions) ?? [];
  const home = hp.routes.path("home") ?? "/";
  const account = hp.routes.path("account");

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{paid ? "Pagamento confirmado!" : "Pedido recebido"}</h1>
        <p className="text-muted-foreground">
          Pedido <strong>#{summary?.orderNumber || orderId}</strong>
          {summary && <> · {formatMoney(summary.total)}</>}
        </p>
      </header>

      {summary && !paid && summary.remaining.amount > 0 && (
        <p className="text-center text-sm">Falta pagar {formatMoney(summary.remaining)}.</p>
      )}

      {pending.map((payment) => (
        <div key={payment.id} className="space-y-2">
          {summary && summary.payments.length > 1 && (
            <p className="text-sm font-medium">
              {payment.title} · {formatMoney(payment.amount)}
            </p>
          )}
          <HeadpressPixInstructions instructions={payment.instructions!} status={pixStatus(payment.status)} />
        </div>
      ))}

      {/* Without the ledger, the instructions checkout() answered. */}
      {!ledgerOn && placed?.instructions && <HeadpressPixInstructions instructions={placed.instructions} />}

      {summary && summary.payments.length > 0 && (
        <ul className="divide-y rounded-lg border text-sm">
          {summary.payments.map((payment) => (
            <li key={payment.id} className="flex justify-between p-3">
              <span>{payment.title || payment.gatewayId}</span>
              <span className="text-muted-foreground">
                {formatMoney(payment.amount)} · {payment.status}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-center gap-6 text-sm">
        <Link href={home} className="underline underline-offset-4">
          Continuar comprando
        </Link>
        {account && (
          <Link href={account} className="underline underline-offset-4">
            Meus pedidos
          </Link>
        )}
      </div>
    </div>
  );
}
