"use client";

/**
 * Product price block for Headpress stores.
 *
 * Shows the price, the regular price struck through while on sale and, only when the server
 * publishes `product.pricePreview`, the Pix price and the best installment line. Nothing here is
 * derived from the price: no Pix percentage, no division by a number of installments. A store that
 * wants those lines turns on the price preview in Headpress.
 */
import type { Money, Product } from "@meumouse/headpress";
import { useFormatMoney, useHeadpress } from "@meumouse/headpress/react";

import { cn } from "@/lib/utils";

export interface HeadpressPriceLabels {
  /** Before the lowest price of a variable product whose variations cost different amounts. */
  from?: string;
  /** Screen-reader prefix of the struck-through price. */
  regularPrice?: string;
  /** Screen-reader prefix of the current price while on sale. */
  salePrice?: string;
  /** "R$ 179,91 no Pix". */
  pix?: (price: string) => string;
  /** Badge next to the Pix price when the server sends a percentage. */
  pixPercent?: (percent: string) => string;
  /** "ou 3x de R$ 66,63 sem juros" / "ou 12x de R$ 19,90". */
  installments?: (count: number, amount: string, interestFree: boolean) => string;
}

const DEFAULT_LABELS: Required<HeadpressPriceLabels> = {
  from: "a partir de",
  regularPrice: "Preço original:",
  salePrice: "Preço promocional:",
  pix: (price) => `${price} no Pix`,
  pixPercent: (percent) => `${percent} de desconto`,
  installments: (count, amount, interestFree) => `ou ${count}x de ${amount}${interestFree ? " sem juros" : ""}`,
};

export type HeadpressPriceProduct = Pick<Product, "price" | "regularPrice" | "onSale" | "priceRange" | "pricePreview">;

export interface HeadpressPriceProps {
  product: HeadpressPriceProduct;
  /** Hide the Pix and installment lines (e.g. in a dense product card). */
  showPreview?: boolean;
  size?: "sm" | "md" | "lg";
  labels?: HeadpressPriceLabels;
  className?: string;
}

const PRICE_SIZE = { sm: "text-base", md: "text-xl", lg: "text-3xl" } as const;

/** The server's percentage in the store's locale (10 → "10%", 7.5 → "7,5%"). */
function percentText(percent: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(percent / 100);
  } catch {
    return `${percent}%`;
  }
}

export function HeadpressPrice({ product, showPreview = true, size = "md", labels, className }: HeadpressPriceProps) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const formatMoney = useFormatMoney();
  const locale = useHeadpress().locale();
  const range = product.priceRange;
  const varies = range !== null && range.min.amount !== range.max.amount;
  const onSale = !varies && product.onSale && product.regularPrice.amount !== product.price.amount;
  const preview = showPreview ? product.pricePreview : null;

  const amount = (value: Money, extra?: string) => (
    <span className={cn("font-semibold tabular-nums text-foreground", PRICE_SIZE[size], extra)}>{formatMoney(value)}</span>
  );

  return (
    <div className={cn("flex flex-col gap-1", className)} data-slot="headpress-price">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {varies && range ? (
          <>
            <span className="text-sm text-muted-foreground">{text.from}</span>
            {amount(range.min)}
          </>
        ) : onSale ? (
          <>
            <span className="text-sm text-muted-foreground line-through tabular-nums">
              <span className="sr-only">{text.regularPrice} </span>
              {formatMoney(product.regularPrice)}
            </span>
            <span>
              <span className="sr-only">{text.salePrice} </span>
              {amount(product.price)}
            </span>
          </>
        ) : (
          amount(product.price)
        )}
      </p>

      {preview?.pix && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
          <span className="font-medium tabular-nums">{text.pix(formatMoney(preview.pix.price))}</span>
          {preview.pix.percent !== null && preview.pix.percent > 0 && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              {text.pixPercent(percentText(preview.pix.percent, locale))}
            </span>
          )}
        </p>
      )}

      {preview?.installments && (
        <p className="text-sm text-muted-foreground tabular-nums">
          {text.installments(preview.installments.count, formatMoney(preview.installments.amount), preview.installments.interestFree)}
        </p>
      )}
    </div>
  );
}

export default HeadpressPrice;
