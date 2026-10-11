"use client";

/**
 * Shipping calculator for the product page, on `useShippingQuote()` (Headpress 1.3+).
 *
 * The rates, their cost and delivery window, and the free-shipping line all come from the server's
 * quote. The free-shipping progress shows only when the server sends `freeShipping`; the threshold
 * is never guessed here.
 */
import { useEffect, useId, useRef } from "react";
import { Loader2, Truck } from "lucide-react";

import type { ShippingQuote } from "@meumouse.com/headpress";
import { useFormatError, useFormatMoney, useShippingQuote } from "@meumouse.com/headpress/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export interface HeadpressShippingCalculatorLabels {
  postcode?: string;
  placeholder?: string;
  submit?: string;
  loading?: string;
  unknownPostcode?: string;
  invalidPostcode?: string;
  free?: string;
  deliveryWindow?: (min: number, max: number, unit: string) => string;
  noRates?: string;
  freeShippingRemaining?: (remaining: string) => string;
  freeShippingReached?: string;
  rates?: string;
}

const UNITS: Record<string, [string, string]> = {
  days: ["dia", "dias"],
  day: ["dia", "dias"],
  business_days: ["dia útil", "dias úteis"],
  working_days: ["dia útil", "dias úteis"],
  hours: ["hora", "horas"],
  hour: ["hora", "horas"],
  weeks: ["semana", "semanas"],
};

const DEFAULT_LABELS: Required<HeadpressShippingCalculatorLabels> = {
  postcode: "Calcular frete e prazo",
  placeholder: "00000-000",
  submit: "Calcular",
  loading: "Calculando frete…",
  unknownPostcode: "Não sei meu CEP",
  invalidPostcode: "Digite um CEP válido.",
  free: "Grátis",
  deliveryWindow: (min, max, unit) => {
    const [one, many] = UNITS[unit] ?? [unit, unit];
    if (min === max || !min) return `até ${max} ${max === 1 ? one : many}`;
    return `${min} a ${max} ${many}`;
  },
  noRates: "Não há entrega disponível para este CEP.",
  freeShippingRemaining: (remaining) => `Faltam ${remaining} para frete grátis.`,
  freeShippingReached: "Você ganhou frete grátis!",
  rates: "Opções de entrega",
};

export interface HeadpressShippingCalculatorProps {
  productId: number;
  variationId?: number;
  quantity?: number;
  /** Called with each new quote. */
  onQuote?: (quote: ShippingQuote) => void;
  /** Where "I don't know my postcode" points; pass null to hide it. */
  postcodeFinderUrl?: string | null;
  /** Keep the last postcode in this browser. Defaults to true. */
  rememberPostcode?: boolean;
  labels?: HeadpressShippingCalculatorLabels;
  className?: string;
}

const STORAGE_KEY = "hp_shipping_postcode";

export function HeadpressShippingCalculator({
  productId,
  variationId,
  quantity = 1,
  onQuote,
  postcodeFinderUrl = "https://buscacepinter.correios.com.br/app/endereco/index.php",
  rememberPostcode = true,
  labels,
  className,
}: HeadpressShippingCalculatorProps) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const formatMoney = useFormatMoney();
  const formatError = useFormatError();
  const [state, actions] = useShippingQuote();
  const id = useId();
  const quotedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!rememberPostcode) return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && !state.postcode) actions.setPostcode(saved);
    } catch {
      // Storage blocked: start empty.
    }
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    const quote = await actions.quote({ productId, variationId, quantity });
    if (!quote) return;
    quotedFor.current = `${productId}:${variationId ?? 0}:${quantity}`;
    onQuote?.(quote);
    if (rememberPostcode) {
      try {
        localStorage.setItem(STORAGE_KEY, state.postcode);
      } catch {
        // Not saved; nothing else depends on it.
      }
    }
  };

  // A new variation or quantity can cost a different freight: quote again for the same postcode.
  useEffect(() => {
    const key = `${productId}:${variationId ?? 0}:${quantity}`;
    if (quotedFor.current && quotedFor.current !== key && state.status === "ready") void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, variationId, quantity]);

  const invalidPostcode = state.status === "error" && state.error?.code === "headpress_invalid_param" && Boolean((state.error.data.fields as Record<string, unknown> | undefined)?.postcode);
  const errorText = state.status === "error" ? (invalidPostcode ? text.invalidPostcode : formatError(state.error, "shipping")) : null;
  const quote = state.status === "ready" ? state.quote : null;
  const free = quote?.freeShipping ?? null;
  const freeProgress = free && free.threshold.amount > 0 ? Math.min(100, Math.max(0, ((free.threshold.amount - free.remaining.amount) / free.threshold.amount) * 100)) : null;

  return (
    <div className={cn("space-y-3", className)} data-slot="headpress-shipping-calculator">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
        className="space-y-2"
        noValidate
      >
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`${id}-postcode`} className="flex items-center gap-2">
            <Truck className="size-4" aria-hidden="true" />
            {text.postcode}
          </Label>
          {postcodeFinderUrl && (
            <a href={postcodeFinderUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
              {text.unknownPostcode}
            </a>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            id={`${id}-postcode`}
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder={text.placeholder}
            value={state.postcode}
            maxLength={9}
            onChange={(event) => actions.setPostcode(event.target.value)}
            aria-invalid={invalidPostcode}
            aria-describedby={errorText ? `${id}-error` : undefined}
            className="max-w-40"
          />
          <Button type="submit" variant="outline" disabled={state.status === "loading"}>
            {state.status === "loading" && <Loader2 className="animate-spin" aria-hidden="true" />}
            {text.submit}
          </Button>
        </div>
      </form>

      <div aria-live="polite" aria-busy={state.status === "loading"} className="space-y-3">
        {state.status === "loading" && <p className="sr-only">{text.loading}</p>}
        {errorText && (
          <p id={`${id}-error`} className="text-sm text-destructive">
            {errorText}
          </p>
        )}

        {quote && quote.rates.length === 0 && <p className="text-sm text-muted-foreground">{text.noRates}</p>}

        {quote && quote.rates.length > 0 && (
          <ul className="divide-y rounded-lg border" aria-label={text.rates}>
            {quote.rates.map((rate) => (
              <li key={rate.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium">{rate.label}</span>
                  {rate.deliveryTime && <span className="block text-xs text-muted-foreground">{text.deliveryWindow(rate.deliveryTime.min, rate.deliveryTime.max, rate.deliveryTime.unit)}</span>}
                </span>
                <span className={cn("shrink-0 font-semibold tabular-nums", rate.cost.amount === 0 && "text-emerald-700 dark:text-emerald-400")}>
                  {rate.cost.amount === 0 ? text.free : formatMoney(rate.cost)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {free && (
          <div className="space-y-1.5">
            <p className="text-sm">{free.remaining.amount > 0 ? text.freeShippingRemaining(formatMoney(free.remaining)) : text.freeShippingReached}</p>
            {freeProgress !== null && <Progress value={freeProgress} aria-hidden="true" />}
          </div>
        )}
      </div>
    </div>
  );
}

export default HeadpressShippingCalculator;
