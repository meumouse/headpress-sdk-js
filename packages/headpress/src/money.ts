/**
 * Money, in one shape.
 *
 * Headpress and the Store API send amounts in minor units (cents for BRL), WooCommerce's own
 * REST API sends decimal strings, and a few Headpress payloads (analytics) use major units. Every
 * normalizer in the SDK turns them into `Money`: an integer amount in minor units plus the currency
 * it is in. Arithmetic stays in integers, so a total never drifts by a cent.
 *
 * The SDK has no percentage or interest helpers on purpose: discounts, installments and fees are
 * the server's decisions, and the interface shows the amounts the server sends.
 */

export interface Money {
  /** Integer amount in minor units (1990 = R$ 19,90). */
  readonly amount: number;
  /** ISO 4217 code. */
  readonly currency: string;
  /** Decimal places of the currency (2 for BRL and USD, 0 for JPY). */
  readonly minorUnit: number;
}

/**
 * A currency as Headpress describes it (`config.commerce.currency`). Only `code` is required; the
 * rest lets `formatMoney` print amounts exactly like WooCommerce does.
 */
export interface CurrencyInfo {
  code: string;
  minor_unit?: number;
  symbol?: string;
  decimal_separator?: string;
  thousand_separator?: string;
  prefix?: string;
  suffix?: string;
}

export type CurrencyInput = string | CurrencyInfo;

/** Decimal places when neither the currency nor the caller says. */
export const DEFAULT_MINOR_UNIT = 2;

function resolveCurrency(currency: CurrencyInput, minorUnit?: number): { code: string; minorUnit: number } {
  const code = typeof currency === "string" ? currency : currency.code;
  const unit =
    minorUnit ?? (typeof currency === "string" ? undefined : currency.minor_unit) ?? DEFAULT_MINOR_UNIT;
  if (!code) throw new TypeError("A currency code is required.");
  if (!Number.isInteger(unit) || unit < 0 || unit > 8) {
    throw new RangeError(`Invalid minor unit: ${unit}.`);
  }
  return { code: code.toUpperCase(), minorUnit: unit };
}

/** `Money` from an integer amount in minor units. Throws on a non-finite amount. */
export function money(amount: number, currency: CurrencyInput, minorUnit?: number): Money {
  if (!Number.isFinite(amount)) throw new RangeError(`Invalid money amount: ${amount}.`);
  const resolved = resolveCurrency(currency, minorUnit);
  // Minor units are integers; a stray fraction (from a payload, not from our arithmetic) rounds.
  return Object.freeze({ amount: Math.round(amount) || 0, currency: resolved.code, minorUnit: resolved.minorUnit });
}

/** An amount in minor units from a number or numeric string, or null when it is not one. */
export function parseMinor(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  if (typeof value !== "string" || !/^\s*-?\d+(\.0+)?\s*$/.test(value)) return null;
  return Math.round(Number(value));
}

/**
 * `Money` from a minor-unit amount as Headpress and the Store API send it (`1990` or `"1990"`),
 * or null when the value is missing or not a number.
 */
export function moneyFromMinor(value: unknown, currency: CurrencyInput, minorUnit?: number): Money | null {
  const amount = parseMinor(value);
  return amount === null ? null : money(amount, currency, minorUnit);
}

/** Minor units of a decimal string, rounding half up on the first dropped digit. */
function decimalToMinor(text: string, minorUnit: number): number | null {
  const match = /^\s*(-)?(\d*)(?:\.(\d*))?\s*$/.exec(text);
  if (!match || (!match[2] && !match[3])) return null;
  const [, sign, int = "", frac = ""] = match;
  const padded = frac.padEnd(minorUnit + 1, "0");
  let minor = Number(int || "0") * 10 ** minorUnit + Number(padded.slice(0, minorUnit) || "0");
  if (Number(padded[minorUnit]) >= 5) minor += 1;
  return sign ? -minor : minor;
}

/**
 * `Money` from a decimal amount: WooCommerce REST strings (`"199.90"`) or major-unit numbers
 * (`199.9`, as Headpress analytics payloads send). Strings are parsed digit by digit, without
 * floating-point error. Null when the value is missing or not a number.
 */
export function moneyFromDecimal(value: unknown, currency: CurrencyInput, minorUnit?: number): Money | null {
  const resolved = resolveCurrency(currency, minorUnit);
  let amount: number | null = null;
  if (typeof value === "number") {
    amount = Number.isFinite(value) ? Math.round(value * 10 ** resolved.minorUnit) : null;
  } else if (typeof value === "string") {
    amount = decimalToMinor(value, resolved.minorUnit);
  }
  return amount === null ? null : money(amount, resolved.code, resolved.minorUnit);
}

/** The amount in major units, for display maths only (charts, analytics payloads). */
export function toMajor(value: Money): number {
  return value.amount / 10 ** value.minorUnit;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency || a.minorUnit !== b.minorUnit) {
    throw new TypeError(`Cannot combine ${a.currency} and ${b.currency} amounts.`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency, a.minorUnit);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency, a.minorUnit);
}

/** Sum of amounts in one currency. An empty list needs the currency to sum in. */
export function sumMoney(values: readonly Money[], currency?: CurrencyInput, minorUnit?: number): Money {
  const first = values[0];
  if (!first) {
    if (currency === undefined) throw new TypeError("sumMoney needs a currency for an empty list.");
    return money(0, currency, minorUnit);
  }
  return values.slice(1).reduce(addMoney, first);
}

/** Line total: an amount times a whole quantity. */
export function multiplyMoney(value: Money, quantity: number): Money {
  if (!Number.isInteger(quantity)) throw new RangeError("Quantity must be a whole number.");
  return money(value.amount * quantity, value.currency, value.minorUnit);
}

/** -1, 0 or 1. */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.amount === b.amount ? 0 : a.amount < b.amount ? -1 : 1;
}

export function isZeroMoney(value: Money): boolean {
  return value.amount === 0;
}

export interface FormatMoneyOptions {
  /**
   * BCP 47 locale for `Intl.NumberFormat`. Pass the store's (`config.store.language`): the default,
   * `en-US`, is fixed so server and browser render the same text.
   */
  locale?: string;
  /**
   * WooCommerce format (`config.commerce.currency`). When given, the amount is printed with its
   * prefix, suffix and separators, exactly like the store's own emails and admin, instead of `Intl`.
   */
  format?: CurrencyInfo;
  /** `Intl` currency display. Ignored with `format`. */
  currencyDisplay?: "symbol" | "narrowSymbol" | "code" | "name";
}

const formatters = new Map<string, Intl.NumberFormat>();

function intlFormatter(locale: string, value: Money, display: string): Intl.NumberFormat {
  const key = `${locale}|${value.currency}|${value.minorUnit}|${display}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: value.currency,
      currencyDisplay: display as Intl.NumberFormatOptions["currencyDisplay"],
      minimumFractionDigits: value.minorUnit,
      maximumFractionDigits: value.minorUnit,
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

function wooFormat(value: Money, format: CurrencyInfo): string {
  const digits = Math.abs(value.amount).toString().padStart(value.minorUnit + 1, "0");
  const int = digits.slice(0, digits.length - value.minorUnit) || "0";
  const frac = value.minorUnit > 0 ? digits.slice(-value.minorUnit) : "";
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, format.thousand_separator ?? ",");
  const number = frac ? `${grouped}${format.decimal_separator ?? "."}${frac}` : grouped;
  const prefix = format.prefix ?? (format.suffix === undefined ? format.symbol ?? "" : "");
  // WooCommerce puts the minus sign before the symbol: -R$ 10,00.
  return `${value.amount < 0 ? "-" : ""}${prefix}${number}${format.suffix ?? ""}`;
}

/** Text for an amount, e.g. `R$ 1.299,90`. */
export function formatMoney(value: Money, options: FormatMoneyOptions = {}): string {
  if (options.format) return wooFormat(value, options.format);
  return intlFormatter(options.locale ?? "en-US", value, options.currencyDisplay ?? "symbol").format(
    toMajor(value),
  );
}
