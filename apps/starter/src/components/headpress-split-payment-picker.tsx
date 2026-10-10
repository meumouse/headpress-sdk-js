"use client";

/**
 * Split payment picker for the checkout (`split_payments` module), on `useSplitBuilder()`.
 *
 * The shopper splits the order total between methods from `config.modules.split_payments.methods`
 * (e.g. part on Pix, part on a card). Local checks (`state.problems`) follow the module's limits;
 * once the plan is valid, the server quotes it and the discount and charge of each part shown here
 * are the server's numbers. This component never computes a discount.
 *
 * Place the order with `paymentMethod: config.modules.split_payments.gateway_id` and
 * `splitLegs: state.legs` (see `onChange`).
 */
import { useEffect, useId, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { addMoney, moneyFromDecimal, moneyFromMinor, type Money, type SplitQuote } from "@meumouse/headpress";
import type { SplitBuilderLeg, SplitBuilderState } from "@meumouse/headpress/controllers";
import { useCapability, useFormatError, useFormatMoney, useHeadpress, useSplitBuilder, useStoreConfig } from "@meumouse/headpress/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type Problem = SplitBuilderState["problems"][number];

export interface HeadpressSplitPaymentPickerLabels {
  heading?: string;
  total?: (total: string) => string;
  method?: string;
  amount?: string;
  part?: (index: number) => string;
  add?: (method: string) => string;
  remove?: (index: number) => string;
  useRemaining?: string;
  /** Method names by kind, when the store's gateway titles are not available. */
  kinds?: Record<string, string>;
  methodDiscount?: (discount: string) => string;
  problems?: Partial<Record<Problem, string>>;
  tooFewLegs?: (min: number) => string;
  tooManyLegs?: (max: number) => string;
  legTooSmall?: (min: string) => string;
  remaining?: (amount: string) => string;
  exceeding?: (amount: string) => string;
  unknownMethod?: string;
  quoting?: string;
  summary?: string;
  discount?: string;
  discountTotal?: string;
  payTotal?: string;
}

const DEFAULT_LABELS = {
  heading: "Dividir o pagamento",
  total: (total: string) => `Total do pedido: ${total}`,
  method: "Forma de pagamento",
  amount: "Valor",
  part: (index: number) => `Parte ${index}`,
  add: (method: string) => `Adicionar ${method}`,
  remove: (index: number) => `Remover a parte ${index}`,
  useRemaining: "Usar o restante",
  kinds: { pix: "Pix", card: "Cartão", boleto: "Boleto", bank_transfer: "Transferência", wallet: "Carteira digital", cash: "Dinheiro", other: "Outro" } as Record<string, string>,
  methodDiscount: (discount: string) => `${discount} de desconto`,
  problems: {} as Partial<Record<Problem, string>>,
  tooFewLegs: (min: number) => `Use pelo menos ${min} formas de pagamento.`,
  tooManyLegs: (max: number) => `Use no máximo ${max} formas de pagamento.`,
  legTooSmall: (min: string) => `Cada parte precisa ser de pelo menos ${min}.`,
  remaining: (amount: string) => `Falta distribuir ${amount}.`,
  exceeding: (amount: string) => `As partes passam do total em ${amount}.`,
  unknownMethod: "Uma das formas de pagamento não está disponível.",
  quoting: "Calculando os valores…",
  summary: "Resumo",
  discount: "Desconto",
  discountTotal: "Descontos",
  payTotal: "Total a pagar",
};

export interface HeadpressSplitPaymentPickerChange {
  legs: SplitBuilderLeg[];
  quote: SplitQuote | null;
  /** The plan passed the local checks and the server quoted it. */
  ready: boolean;
}

export interface HeadpressSplitPaymentPickerProps {
  /** The order total to split (the cart's total, from the server). */
  total: Money;
  initialLegs?: readonly SplitBuilderLeg[];
  onChange?: (change: HeadpressSplitPaymentPickerChange) => void;
  /** Method titles by gateway id; by default they come from `hp.checkout.paymentMethods()`. */
  methodTitles?: Record<string, string>;
  labels?: HeadpressSplitPaymentPickerLabels;
  className?: string;
}

/** Minor units as an editable decimal ("1234,50"), without floating point. */
function toInput(value: Money, decimal: string): string {
  const digits = Math.abs(value.amount).toString().padStart(value.minorUnit + 1, "0");
  const whole = digits.slice(0, digits.length - value.minorUnit) || "0";
  const fraction = value.minorUnit ? digits.slice(-value.minorUnit) : "";
  return `${value.amount < 0 ? "-" : ""}${whole}${fraction ? decimal + fraction : ""}`;
}

/** What the shopper typed, in the store's separators, as a plain decimal string. */
function normalizeDecimal(input: string, decimal: string, thousand: string): string {
  let value = input.trim();
  if (thousand && thousand !== decimal) value = value.split(thousand).join("");
  if (decimal !== ".") value = value.split(decimal).join(".");
  return value.replace(/[^\d.]/g, "");
}

export function HeadpressSplitPaymentPicker({ total, initialLegs, onChange, methodTitles, labels, className }: HeadpressSplitPaymentPickerProps) {
  const text = { ...DEFAULT_LABELS, ...labels, kinds: { ...DEFAULT_LABELS.kinds, ...labels?.kinds }, problems: { ...labels?.problems } };
  const hp = useHeadpress();
  const config = useStoreConfig();
  const settings = useCapability("split_payments");
  const formatMoney = useFormatMoney();
  const formatError = useFormatError();
  const [state, actions] = useSplitBuilder({ total, legs: initialLegs });
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const id = useId();

  const decimal = config?.commerce?.currency.decimal_separator || ",";
  const thousand = config?.commerce?.currency.thousand_separator ?? ".";
  const locale = hp.locale();

  useEffect(() => {
    if (methodTitles) return;
    let cancelled = false;
    hp.checkout
      .paymentMethods()
      .then((methods) => {
        if (!cancelled) setTitles(Object.fromEntries(methods.map((method) => [method.id, method.title])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hp, methodTitles]);

  useEffect(() => {
    onChange?.({ legs: state.legs, quote: state.quote, ready: state.status === "ready" && state.problems.length === 0 && state.quote !== null });
    // Report each state change, not each new callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const methods = useMemo(
    () =>
      (settings?.methods ?? [])
        .filter((method): method is typeof method & { id: string } => typeof method.id === "string" && method.id !== "")
        .map((method) => ({ id: method.id, kind: method.kind ?? "other", discount: method.discount ?? null })),
    [settings],
  );

  if (config && (!settings || !settings.checkout_enabled)) return null;
  if (!settings) return null;

  const titleOf = (gatewayId: string) => {
    const method = methods.find((entry) => entry.id === gatewayId);
    return methodTitles?.[gatewayId] ?? titles[gatewayId] ?? (method ? text.kinds[method.kind] ?? method.kind : gatewayId);
  };

  const discountText = (discount: (typeof methods)[number]["discount"]): string | null => {
    if (!discount || typeof discount.amount !== "number" || discount.amount <= 0) return null;
    if (discount.type === "fixed") {
      const amount = moneyFromMinor(discount.amount, total.currency, total.minorUnit);
      return amount ? text.methodDiscount(formatMoney(amount)) : null;
    }
    try {
      return text.methodDiscount(new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(discount.amount / 100));
    } catch {
      return text.methodDiscount(`${discount.amount}%`);
    }
  };

  const problemText = (problem: Problem): string => {
    const custom = text.problems[problem];
    if (custom) return custom;
    switch (problem) {
      case "too_few_legs":
        return text.tooFewLegs(settings.min_legs || 2);
      case "too_many_legs":
        return text.tooManyLegs(settings.max_legs || 5);
      case "leg_too_small": {
        const min = moneyFromMinor(settings.min_leg_amount || 1, total.currency, total.minorUnit);
        return text.legTooSmall(min ? formatMoney(min) : String(settings.min_leg_amount));
      }
      case "sum_mismatch":
        return state.unassigned.amount > 0
          ? text.remaining(formatMoney(state.unassigned))
          : text.exceeding(formatMoney({ ...state.unassigned, amount: -state.unassigned.amount }));
      case "unknown_method":
        return text.unknownMethod;
    }
  };

  const setAmount = (index: number, input: string) => {
    setDrafts((current) => ({ ...current, [index]: input }));
    const parsed = moneyFromDecimal(normalizeDecimal(input, decimal, thousand), total.currency, total.minorUnit);
    if (parsed) actions.setLeg(index, { amount: parsed });
  };

  const dropDraft = (index: number) =>
    setDrafts((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });

  const maxLegs = settings.max_legs || 5;
  const quote = state.status === "ready" ? state.quote : null;

  return (
    <section className={cn("space-y-4", className)} aria-labelledby={`${id}-heading`} data-slot="headpress-split-payment-picker">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`${id}-heading`} className="text-base font-semibold">
          {text.heading}
        </h3>
        <p className="text-sm text-muted-foreground tabular-nums">{text.total(formatMoney(state.total))}</p>
      </div>

      <ol className="space-y-3">
        {state.legs.map((leg, index) => {
          const method = methods.find((entry) => entry.id === leg.gatewayId);
          const discount = method ? discountText(method.discount) : null;
          return (
            <li key={index} className="rounded-lg border p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">{text.part(index + 1)}</p>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-method-${index}`}>{text.method}</Label>
                  <Select value={leg.gatewayId} onValueChange={(value) => actions.setLeg(index, { gatewayId: value })}>
                    <SelectTrigger id={`${id}-method-${index}`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {methods.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          {titleOf(entry.id)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {discount && <p className="text-xs text-emerald-700 dark:text-emerald-400">{discount}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-amount-${index}`}>{text.amount}</Label>
                  <Input
                    id={`${id}-amount-${index}`}
                    inputMode="decimal"
                    autoComplete="off"
                    value={drafts[index] ?? toInput(leg.amount, decimal)}
                    onChange={(event) => setAmount(index, event.target.value)}
                    onBlur={() => dropDraft(index)}
                    className="tabular-nums"
                  />
                </div>
                <div className="flex gap-1">
                  {state.unassigned.amount !== 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        dropDraft(index);
                        actions.setLeg(index, { amount: addMoney(leg.amount, state.unassigned) });
                      }}
                    >
                      {text.useRemaining}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={text.remove(index + 1)}
                    onClick={() => {
                      setDrafts({});
                      actions.removeLeg(index);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {state.legs.length < maxLegs && methods.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {methods.map((method) => (
            <Button key={method.id} type="button" variant="outline" size="sm" onClick={() => actions.addLeg(method.id)}>
              <Plus aria-hidden="true" />
              {text.add(titleOf(method.id))}
            </Button>
          ))}
        </div>
      )}

      <div aria-live="polite" className="space-y-2">
        {state.problems.length > 0 && (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {state.problems.map((problem) => (
              <li key={problem}>{problemText(problem)}</li>
            ))}
          </ul>
        )}
        {state.status === "quoting" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {text.quoting}
          </p>
        )}
        {state.status === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {formatError(state.error, "checkout")}
          </p>
        )}
      </div>

      {quote && (
        <div className="space-y-2 rounded-lg bg-muted/50 p-4 text-sm">
          <p className="font-medium">{text.summary}</p>
          <ul className="space-y-1.5">
            {quote.legs.map((leg, index) => (
              <li key={`${leg.gatewayId}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span>{titleOf(leg.gatewayId)}</span>
                <span className="tabular-nums">
                  {leg.discount.amount > 0 && (
                    <span className="mr-2 text-xs text-emerald-700 dark:text-emerald-400">
                      {text.discount} −{formatMoney(leg.discount)}
                    </span>
                  )}
                  <span className="font-medium">{formatMoney(leg.charge)}</span>
                </span>
              </li>
            ))}
          </ul>
          <Separator />
          {quote.discountTotal.amount > 0 && (
            <p className="flex justify-between text-emerald-700 dark:text-emerald-400">
              <span>{text.discountTotal}</span>
              <span className="tabular-nums">−{formatMoney(quote.discountTotal)}</span>
            </p>
          )}
          <p className="flex justify-between font-semibold">
            <span>{text.payTotal}</span>
            <span className="tabular-nums">{formatMoney(quote.chargeTotal)}</span>
          </p>
        </div>
      )}
    </section>
  );
}

export default HeadpressSplitPaymentPicker;
