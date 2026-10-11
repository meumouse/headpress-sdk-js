"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import type { OrderSummary } from "@meumouse.com/headpress";
import { useCapability, useCustomer, useFormatError, useFormatMoney, useHeadpress } from "@meumouse.com/headpress/react";

import { HeadpressOtpLogin } from "@/components/headpress-otp-login";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useAnalytics } from "@/modules/analytics/analytics-provider";

function PasswordLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const hp = useHeadpress();
  const formatError = useFormatError();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Through the BFF: the refresh token lands in an httpOnly cookie, never in this page.
      await hp.auth.login({ login, password });
      onSignedIn();
    } catch (reason) {
      setError(formatError(reason, "login"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="font-semibold">Entrar com senha</h2>
      <div className="grid gap-1.5">
        <Label htmlFor="login">E-mail</Label>
        <Input id="login" type="email" autoComplete="username" required value={login} onChange={(event) => setLogin(event.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="password">Senha</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}

function Orders() {
  const hp = useHeadpress();
  const formatMoney = useFormatMoney();
  const formatError = useFormatError();
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    hp.customer.orders
      .list({ perPage: 20 })
      .then((page) => {
        if (!cancelled) setOrders(page.items);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(formatError(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [hp, formatError]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!orders) return <p className="text-sm text-muted-foreground">Carregando pedidos…</p>;
  if (orders.length === 0) return <p className="text-sm text-muted-foreground">Você ainda não fez pedidos.</p>;

  return (
    <ul className="divide-y rounded-lg border">
      {orders.map((order) => {
        const path = hp.routes.path("account_order", { order_id: order.id });
        const pay = order.needs_payment ? hp.routes.path("order_received", { order_id: order.id, order_key: order.order_key }) : null;
        return (
          <li key={order.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 p-4 text-sm">
            <span className="font-medium">{path ? <Link href={path}>#{order.number}</Link> : `#${order.number}`}</span>
            <span className="text-muted-foreground">
              {order.date_created ? new Date(order.date_created).toLocaleDateString("pt-BR") : ""}
            </span>
            <span>{order.status_label || order.status}</span>
            <span className="ml-auto font-medium">{formatMoney(order.total)}</span>
            {pay && (
              <Link href={pay} className="w-full text-xs underline underline-offset-4 sm:w-auto">
                Pagar
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Sign-in (one-time code from the registry, or password) and, once signed in, the orders list.
 * The session lives in the BFF (`app/api/auth/[...action]`): `useCustomer()` restores it on load.
 */
export function AccountTemplate() {
  const hp = useHeadpress();
  const passwordless = useCapability("passwordless");
  const accounts = useCapability("accounts");
  const { tracker } = useAnalytics();
  const { customer, status, reload } = useCustomer();

  if (status === "loading") return <p className="text-muted-foreground">Carregando…</p>;

  if (!customer) {
    const signedIn = (method: string) => {
      tracker?.track("login", { method });
      void reload();
    };
    return (
      <div className="mx-auto grid max-w-3xl gap-10 md:grid-cols-2">
        {passwordless && <HeadpressOtpLogin onSignedIn={() => signedIn("otp")} />}
        {accounts && <PasswordLogin onSignedIn={() => signedIn("password")} />}
        {!passwordless && !accounts && <p className="text-muted-foreground">A loja não oferece contas de cliente.</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Olá, {customer.first_name || customer.display_name}</h1>
          <p className="text-sm text-muted-foreground">{customer.email}</p>
        </div>
        <Button
          variant="outline"
          onClick={async () => {
            await hp.auth.logout();
            tracker?.reset();
            void reload();
          }}
        >
          Sair
        </Button>
      </header>
      <Separator />
      <section className="space-y-3">
        <h2 className="font-semibold">Pedidos</h2>
        <Orders />
      </section>
    </div>
  );
}
