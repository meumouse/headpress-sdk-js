"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { Address, PaymentMethod } from "@meumouse.com/headpress";
import { browserIds, cartEventParams, checkoutAttribution, checkoutConsent } from "@meumouse.com/headpress/analytics";
import { brazilianMarketValues } from "@meumouse.com/headpress/br";
import type { AddressFormValues, SplitBuilderLeg } from "@meumouse.com/headpress/controllers";
import { useCart, useFormatError, useFormatMoney, useHeadpress, useStoreConfig } from "@meumouse.com/headpress/react";

import { HeadpressAddressForm } from "@/components/headpress-address-form";
import { HeadpressSplitPaymentPicker } from "@/components/headpress-split-payment-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useAnalytics } from "@/modules/analytics/analytics-provider";

/** Where the order-received page finds the placed order's instructions when the ledger is off. */
export const PLACED_KEY = (orderId: number | string) => `hp_placed_${orderId}`;

const KIND_LABELS: Record<string, string> = {
  pix: "Pix",
  card: "Cartão",
  boleto: "Boleto",
  bank_transfer: "Transferência",
  wallet: "Carteira digital",
  offline: "Pagamento offline",
  other: "Outro",
};

/** Store API address fields from the registry form (number, neighborhood and document travel as checkout fields). */
function toStoreAddress(values: AddressFormValues, email: string): Partial<Address> {
  return {
    first_name: values.first_name ?? "",
    last_name: values.last_name ?? "",
    company: values.company ?? "",
    address_1: values.address_1 ?? "",
    address_2: values.address_2 ?? "",
    city: values.city ?? "",
    state: values.state ?? "",
    postcode: values.postcode ?? "",
    country: values.country || "BR",
    phone: values.phone ?? "",
    email,
  };
}

/**
 * Checkout: e-mail and address (registry form), shipping rates from the Store API, payment methods
 * as Headpress describes them (`kind` from the server, never guessed from the id), and the order
 * placed with the Brazilian Market fields, order attribution and the shopper's consent.
 */
export function CheckoutTemplate() {
  const hp = useHeadpress();
  const router = useRouter();
  const config = useStoreConfig();
  const formatMoney = useFormatMoney();
  const formatError = useFormatError();
  const { consent, attribution, tracker } = useAnalytics();
  const [cartState, cartActions] = useCart();
  const cart = cartState.cart;

  const [email, setEmail] = useState("");
  const [address, setAddress] = useState<AddressFormValues | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [methodId, setMethodId] = useState<string>("");
  const [split, setSplit] = useState<{ legs: SplitBuilderLeg[]; ready: boolean }>({ legs: [], ready: false });
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const splitGateway = config?.modules.split_payments?.checkout_enabled ? config.modules.split_payments.gateway_id : null;

  useEffect(() => {
    let cancelled = false;
    hp.checkout
      .paymentMethods()
      .then((list) => {
        if (!cancelled) setMethods(list);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(formatError(reason, "checkout"));
      });
    return () => {
      cancelled = true;
    };
  }, [hp, formatError]);

  const begun = useRef(false);
  useEffect(() => {
    if (!tracker || !cart || cart.items.length === 0 || begun.current) return;
    begun.current = true;
    tracker.track("begin_checkout", { ...cartEventParams(cart) });
  }, [tracker, cart]);

  if (!cart) return <p className="text-muted-foreground">Carregando…</p>;
  if (cart.items.length === 0) {
    const cartPath = hp.routes.path("cart");
    return (
      <div className="space-y-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Seu carrinho está vazio</h1>
        {cartPath && (
          <Link href={cartPath} className="underline underline-offset-4">
            Voltar ao carrinho
          </Link>
        )}
      </div>
    );
  }

  // Gateways the Store API offers for this cart, described by Headpress.
  const available = (methods ?? []).filter((method) => cart.paymentMethods.length === 0 || cart.paymentMethods.includes(method.id));
  const method = available.find((entry) => entry.id === methodId) ?? null;
  const isSplit = method !== null && method.id === splitGateway;
  // Card gateways need a payment adapter (definePaymentAdapter) to tokenize the card; this starter has none.
  const unsupported = (entry: PaymentMethod) => entry.kind === "card";
  const shippingReady = !cart.needsShipping || cart.shippingPackages.every((pkg) => pkg.rates.some((rate) => rate.selected));
  const canPlace = Boolean(address && email && method && !unsupported(method) && shippingReady && (!isSplit || split.ready));

  async function saveAddress(values: AddressFormValues) {
    setError(null);
    const storeAddress = toStoreAddress(values, email);
    // The Store API recalculates shipping rates and taxes for the address.
    const next = await cartActions.updateCustomer({ billing_address: storeAddress, shipping_address: storeAddress });
    if (next) setAddress(values);
  }

  async function placeOrder() {
    if (!address || !method) return;
    setPlacing(true);
    setError(null);
    try {
      const decision = consent.get();
      const billingAddress = toStoreAddress(address, email);
      tracker?.track("add_payment_info", { ...cartEventParams(cart!), payment_type: method.kind });
      const placed = await hp.checkout.place({
        billingAddress,
        shippingAddress: billingAddress,
        paymentMethod: method.id,
        // Brazilian Market checkout fields (CPF/CNPJ, number, neighborhood, cellphone).
        fields: brazilianMarketValues({
          document: address.document,
          number: address.number,
          neighborhood: address.neighborhood,
          cellphone: address.phone,
        }),
        attribution:
          checkoutAttribution(attribution, browserIds(decision), { woocommerce: config?.modules.woocommerce, consent: decision }) ?? undefined,
        consent: checkoutConsent(decision),
        ...(isSplit ? { splitLegs: split.legs } : {}),
      });

      try {
        sessionStorage.setItem(PLACED_KEY(placed.orderId), JSON.stringify({ instructions: placed.instructions, status: placed.paymentStatus }));
      } catch {
        // Storage blocked: the order page reads the ledger instead.
      }
      void cartActions.load();

      // Gateways whose hosted page takes over (the server says so with `supports_redirect`).
      if (method.supportsRedirect && placed.redirectUrl) {
        window.location.assign(placed.redirectUrl);
        return;
      }
      const received = hp.routes.path("order_received", { order_id: placed.orderId, order_key: placed.orderKey });
      router.push(received ?? hp.routes.path("home") ?? "/");
    } catch (reason) {
      setError(formatError(reason, "checkout"));
      setPlacing(false);
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
      <div className="space-y-8">
        <h1 className="text-2xl font-semibold tracking-tight">Finalizar compra</h1>

        <section className="space-y-4">
          <h2 className="font-semibold">1. Contato e endereço</h2>
          <div className="grid gap-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <HeadpressAddressForm
            showDocument
            requireDocument
            showPhone
            onSubmit={(values) => saveAddress(values)}
            labels={{ submit: address ? "Atualizar endereço" : "Continuar", submitting: "Calculando frete…" }}
          />
          {!email && address && <p className="text-sm text-destructive">Informe o e-mail.</p>}
        </section>

        {address && cart.needsShipping && (
          <section className="space-y-3">
            <h2 className="font-semibold">2. Entrega</h2>
            {cart.shippingPackages.map((pkg) => (
              <fieldset key={pkg.id} className="space-y-2 rounded-lg border p-4">
                <legend className="px-1 text-sm text-muted-foreground">{pkg.name}</legend>
                {pkg.rates.length === 0 && <p className="text-sm">Não há entrega para este endereço.</p>}
                {pkg.rates.map((rate) => (
                  <label key={rate.id} className="flex items-center gap-3 text-sm">
                    <input
                      type="radio"
                      name={`shipping-${pkg.id}`}
                      checked={rate.selected}
                      disabled={cartState.pending.includes("shipping")}
                      onChange={() => void cartActions.selectShippingRate(pkg.id, rate.id)}
                    />
                    <span className="flex-1">
                      {rate.name}
                      {rate.deliveryTime && <span className="text-muted-foreground"> · {rate.deliveryTime}</span>}
                    </span>
                    <span>{rate.price.amount === 0 ? "Grátis" : formatMoney(rate.price)}</span>
                  </label>
                ))}
              </fieldset>
            ))}
          </section>
        )}

        {address && (
          <section className="space-y-3">
            <h2 className="font-semibold">{cart.needsShipping ? "3." : "2."} Pagamento</h2>
            {methods === null && !error && <p className="text-sm text-muted-foreground">Carregando formas de pagamento…</p>}
            <div className="space-y-2">
              {available.map((entry) => (
                <label key={entry.id} className="flex items-start gap-3 rounded-lg border p-4 text-sm has-[:checked]:border-primary">
                  <input
                    type="radio"
                    name="payment-method"
                    className="mt-1"
                    value={entry.id}
                    checked={methodId === entry.id}
                    disabled={unsupported(entry)}
                    onChange={() => setMethodId(entry.id)}
                  />
                  <span className="flex-1 space-y-1">
                    <span className="flex items-center gap-2 font-medium">
                      {entry.title}
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                        {KIND_LABELS[entry.kind] ?? entry.kind}
                      </span>
                    </span>
                    {entry.description && <span className="block text-muted-foreground">{entry.description}</span>}
                    {unsupported(entry) && (
                      <span className="block text-xs text-muted-foreground">Cartão precisa de um adaptador de pagamento (definePaymentAdapter).</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
            {isSplit && (
              <HeadpressSplitPaymentPicker total={cart.totals.total} onChange={(change) => setSplit({ legs: change.legs, ready: change.ready })} />
            )}
          </section>
        )}

        {(error || cartState.error) && (
          <p role="alert" className="text-sm text-destructive">
            {error ?? formatError(cartState.error, "checkout")}
          </p>
        )}

        {address && (
          <Button size="lg" className="w-full sm:w-auto" disabled={!canPlace || placing} onClick={placeOrder}>
            {placing ? "Enviando pedido…" : method?.orderButtonText || "Fazer pedido"}
          </Button>
        )}
      </div>

      <aside className="h-fit space-y-3 rounded-lg border p-5 text-sm">
        <h2 className="font-semibold">Seu pedido</h2>
        {cart.items.map((line) => (
          <div key={line.key} className="flex justify-between gap-4">
            <span>
              {line.quantity}× {line.name}
            </span>
            <span>{formatMoney(line.total)}</span>
          </div>
        ))}
        <Separator />
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span>{formatMoney(cart.totals.subtotal)}</span>
        </div>
        {cart.totals.discount.amount > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Descontos</span>
            <span>−{formatMoney(cart.totals.discount)}</span>
          </div>
        )}
        {cart.totals.shipping !== null && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Frete</span>
            <span>{formatMoney(cart.totals.shipping)}</span>
          </div>
        )}
        <Separator />
        <div className="flex justify-between text-base font-semibold">
          <span>Total</span>
          <span>{formatMoney(cart.totals.total)}</span>
        </div>
      </aside>
    </div>
  );
}
