/**
 * Payment data the storefront shows but never computes: what a gateway asked the shopper to do
 * (Pix QR code, bank slip), the order's payment ledger, balance payments and payment links
 * (`split_payments` module).
 */
import { isHeadpressError } from "./errors.js";
import { moneyFromMinor, type CurrencyInfo, type Money } from "./money.js";
import type { Transport } from "./transport.js";

/* ------------------------------------------------------------------ */
/* Instructions                                                        */
/* ------------------------------------------------------------------ */

export type PaymentInstructions =
  | { type: "pix"; code: string; imageBase64: string; expiresAt: string | null }
  | { type: "boleto"; url: string; barcode: string | null };

/** `payment_details` as Headpress sends it (object), or the Store API's `[{ key, value }]` list. */
export type PaymentDetails = Record<string, unknown> | readonly { key?: unknown; value?: unknown }[] | null | undefined;

const PIX_CODE_KEYS = ["pix_qr_code", "asaas_pix_payload", "pix_copy_paste", "pix_copia_e_cola", "pix_payload", "pix_code", "qr_code", "emv"];
const PIX_IMAGE_KEYS = ["pix_qr_code_base64", "asaas_pix_qr_code", "asaas_pix_encoded_image", "qr_code_base64", "pix_qr_image", "encoded_image"];
const PIX_EXPIRY_KEYS = ["pix_expires_at", "asaas_pix_expires_at", "pix_expiration_date", "date_of_expiration", "expiration_date", "expires_at"];
const BOLETO_URL_KEYS = ["boleto_url", "asaas_bank_slip_url", "asaas_boleto_url", "bank_slip_url", "ticket_url", "external_resource_url"];
const BOLETO_BARCODE_KEYS = ["boleto_barcode", "barcode", "digitable_line", "linha_digitavel", "identification_field", "asaas_boleto_barcode"];

/** The details as a flat map of non-empty strings. */
export function paymentDetailsRecord(details: PaymentDetails): Record<string, string> {
  const out: Record<string, string> = {};
  if (!details) return out;
  const entries: [unknown, unknown][] = Array.isArray(details)
    ? details.map((entry) => [entry?.key, entry?.value])
    : Object.entries(details);
  for (const [key, value] of entries) {
    if (typeof key !== "string" || !key) continue;
    if (typeof value !== "string" && typeof value !== "number") continue;
    const text = String(value).trim();
    if (text) out[key] = text;
  }
  return out;
}

/** An EMV "copia e cola" Pix code (BR Code). */
function isPixCode(value: string): boolean {
  return /^0002\d{2}/.test(value) && value.length >= 50 && !/\s/.test(value);
}

function imageBase64(value: string): string {
  const dataUri = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(value);
  if (dataUri?.[1]) return dataUri[1];
  if (/^(iVBOR|\/9j\/|R0lGOD)/.test(value)) return value;
  return value.length > 300 && /^[A-Za-z0-9+/]+=*$/.test(value) ? value : "";
}

const isUrl = (value: string): boolean => /^https?:\/\/\S+$/i.test(value);

/** ISO 8601, also from WordPress's `Y-m-d H:i:s`. */
function isoDate(value: string | null | undefined): string {
  if (!value) return "";
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value) ? value.replace(" ", "T") : value;
  return Number.isNaN(Date.parse(normalized)) ? "" : normalized;
}

function pick(record: Record<string, string>, keys: readonly string[], accept: (value: string) => string): string {
  for (const key of keys) {
    const value = record[key];
    const accepted = value ? accept(value) : "";
    if (accepted) return accepted;
  }
  return "";
}

function pickByPattern(record: Record<string, string>, pattern: RegExp, accept: (value: string) => string): string {
  for (const [key, value] of Object.entries(record)) {
    if (!pattern.test(key)) continue;
    const accepted = accept(value);
    if (accepted) return accepted;
  }
  return "";
}

export interface InstructionsSource {
  details: PaymentDetails;
  /** Kind of the method (`pix`, `boleto`, `card`…), when known. */
  kind?: string;
  /** The part's own expiry, preferred over the gateway's. */
  expiresAt?: string | null;
  /** For bank slips that only come as a redirect. */
  redirectUrl?: string | null;
}

/**
 * What the shopper must do to finish an async payment, read from whatever the gateway answered:
 * known keys of Mercado Pago, Asaas and Headpress first, then a conservative fallback on the key
 * name *and* the value (an EMV Pix code, a base64 image, an http(s) URL) so a value never lands in
 * the wrong place. Null for cards and anything else with nothing to act on.
 */
export function paymentInstructions(source: InstructionsSource): PaymentInstructions | null {
  const record = paymentDetailsRecord(source.details);
  const kind = (source.kind ?? "").toLowerCase();

  if (kind !== "boleto" && kind !== "card") {
    const acceptCode = (value: string): string => (isPixCode(value) ? value : "");
    const code = pick(record, PIX_CODE_KEYS, acceptCode) || pickByPattern(record, /qr|payload|copia|pix|emv/i, acceptCode);
    const image = pick(record, PIX_IMAGE_KEYS, imageBase64) || pickByPattern(record, /qr|pix/i, imageBase64);
    if (code || image) {
      const expires = isoDate(source.expiresAt) || pick(record, PIX_EXPIRY_KEYS, isoDate) || pickByPattern(record, /expir/i, isoDate);
      return { type: "pix", code, imageBase64: image, expiresAt: expires || null };
    }
  }

  if (kind !== "pix" && kind !== "card") {
    const acceptUrl = (value: string): string => (isUrl(value) ? value : "");
    const url =
      pick(record, BOLETO_URL_KEYS, acceptUrl) ||
      pickByPattern(record, /boleto|ticket|bank_?slip/i, acceptUrl) ||
      (kind === "boleto" ? acceptUrl(source.redirectUrl ?? "") : "");
    if (url) {
      const barcode = pick(record, BOLETO_BARCODE_KEYS, (value) => (/^[\d .]{40,}$/.test(value) ? value : ""));
      return { type: "boleto", url, barcode: barcode || null };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Ledger                                                              */
/* ------------------------------------------------------------------ */

export interface PaymentMethodOption {
  id: string;
  title: string;
  kind: string;
  /** The server's discount rule for this method: a percentage, or `Money` when fixed. */
  discount: { type: "percentage"; percent: number } | { type: "fixed"; amount: Money } | null;
}

export interface OrderPayment {
  id: number;
  gatewayId: string;
  title: string;
  kind: string;
  amount: Money;
  refunded: Money;
  status: "pending" | "paid" | "failed" | "expired" | "cancelled" | "refunded" | (string & {});
  source: string;
  createdAt: string | null;
  paidAt: string | null;
  expiresAt: string | null;
  paymentOrder: { id: number; key: string } | null;
  /** Only while pending. */
  instructions: PaymentInstructions | null;
  /** WordPress order-pay page, for gateways that only pay through their hosted form. */
  payUrl: string | null;
  redirectUrl: string | null;
  raw: Record<string, unknown>;
}

export interface OrderPayments {
  orderId: number;
  orderNumber: string;
  orderStatus: string;
  total: Money;
  paid: Money;
  pending: Money;
  remaining: Money;
  refunded: Money;
  state: "unpaid" | "partial" | "paid" | "overpaid" | "refunded" | (string & {});
  isSplit: boolean;
  /** The balance can be paid now. */
  needsPayment: boolean;
  payments: OrderPayment[];
  /** Methods that can pay the balance. */
  methods: PaymentMethodOption[];
}

export interface PaymentLink {
  order: { number: string; createdAt: string | null; total: Money; paid: Money; remaining: Money; items: { name: string; quantity: number; total: Money; image: string | null }[] };
  amount: Money;
  fixed: boolean;
  payable: boolean;
  methods: PaymentMethodOption[];
  payments: OrderPayment[];
  expiresAt: string | null;
}

export interface PaymentAttempt {
  payment: OrderPayment | null;
  result: { status: string; message: string; redirectUrl: string | null; instructions: PaymentInstructions | null; payUrl: string | null };
  summary: OrderPayments | null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function normalizeMethodOption(value: unknown, currency: CurrencyInfo): PaymentMethodOption {
  const data = record(value);
  const discount = record(data.discount);
  const amount = Number(discount.amount);
  return {
    id: String(data.id ?? ""),
    title: String(data.title ?? ""),
    kind: String(data.kind ?? "other"),
    discount:
      data.discount && Number.isFinite(amount)
        ? discount.type === "fixed"
          ? { type: "fixed", amount: moneyFromMinor(amount, currency)! }
          : { type: "percentage", percent: amount }
        : null,
  };
}

export function normalizeOrderPayment(value: unknown, currency: CurrencyInfo): OrderPayment {
  const data = record(value);
  const order = record(data.payment_order);
  const kind = String(data.kind ?? "other");
  const status = String(data.status ?? "pending");
  return {
    id: Number(data.id) || 0,
    gatewayId: String(data.gateway_id ?? ""),
    title: String(data.title ?? ""),
    kind,
    amount: moneyFromMinor(data.amount, currency) ?? moneyFromMinor(0, currency)!,
    refunded: moneyFromMinor(data.refunded_amount ?? 0, currency) ?? moneyFromMinor(0, currency)!,
    status,
    source: String(data.source ?? ""),
    createdAt: text(data.created_at),
    paidAt: text(data.paid_at),
    expiresAt: text(data.expires_at),
    paymentOrder: order.id ? { id: Number(order.id), key: String(order.key ?? "") } : null,
    instructions:
      status === "pending"
        ? paymentInstructions({ details: data.payment_details as PaymentDetails, kind, expiresAt: text(data.expires_at), redirectUrl: text(data.redirect_url) })
        : null,
    payUrl: text(data.pay_url),
    redirectUrl: text(data.redirect_url),
    raw: data,
  };
}

export function normalizeOrderPayments(value: unknown, minorUnit = 2): OrderPayments {
  const data = record(value);
  const currency: CurrencyInfo = { code: String(data.currency || "USD"), minor_unit: minorUnit };
  const money = (amount: unknown): Money => moneyFromMinor(amount ?? 0, currency) ?? moneyFromMinor(0, currency)!;
  return {
    orderId: Number(data.order_id) || 0,
    orderNumber: String(data.order_number ?? ""),
    orderStatus: String(data.order_status ?? ""),
    total: money(data.total),
    paid: money(data.paid),
    pending: money(data.pending),
    remaining: money(data.remaining),
    refunded: money(data.refunded),
    state: String(data.state ?? "unpaid"),
    isSplit: data.is_split === true,
    needsPayment: data.needs_payment === true,
    payments: (Array.isArray(data.payments) ? data.payments : []).map((payment) => normalizeOrderPayment(payment, currency)),
    methods: (Array.isArray(data.methods) ? data.methods : []).map((method) => normalizeMethodOption(method, currency)),
  };
}

function normalizeAttempt(value: unknown, minorUnit: number): PaymentAttempt {
  const data = record(value);
  const summary = data.summary ? normalizeOrderPayments(data.summary, minorUnit) : null;
  const currency: CurrencyInfo = { code: summary?.total.currency ?? "USD", minor_unit: minorUnit };
  const result = record(data.result);
  const payment = data.payment ? normalizeOrderPayment(data.payment, currency) : null;
  return {
    payment,
    result: {
      status: String(result.status ?? ""),
      message: String(result.message ?? ""),
      redirectUrl: text(result.redirect_url),
      payUrl: text(result.pay_url),
      instructions: paymentInstructions({ details: result.payment_details as PaymentDetails, kind: payment?.kind, redirectUrl: text(result.redirect_url) }),
    },
    summary,
  };
}

export interface PayInput {
  gatewayId: string;
  /** Defaults to everything due. */
  amount?: Money | number;
  /** What the gateway's own checkout sends (`[{ key, value }]`). */
  paymentData?: readonly { key: string; value: string }[];
}

export interface Payments {
  /** The order's payment ledger (order key, or the signed-in customer who placed it). Null for an unknown order. */
  summary(orderId: number, options: { key?: string }): Promise<OrderPayments | null>;
  /** Pay the balance (cancels the pending parts first). */
  payBalance(orderId: number, input: PayInput, options: { key?: string }): Promise<PaymentAttempt>;
  /** A payment link; null for an unknown token. Gone links reject with `headpress_link_gone`. */
  link(token: string): Promise<PaymentLink | null>;
  payLink(token: string, input: Omit<PayInput, "amount">): Promise<PaymentAttempt>;
}

export function createPayments(transport: Transport, minorUnit: () => number): Payments {
  return {
    async summary(orderId, options) {
      try {
        const data = await transport.request(`/store/orders/${orderId}/payments`, {
          query: { key: options.key },
          auth: "optional",
          module: "split_payments",
          fetchOptions: { cache: "no-store" },
        });
        return normalizeOrderPayments(data, minorUnit());
      } catch (error) {
        if (isHeadpressError(error, "headpress_not_found")) return null;
        throw error;
      }
    },
    async payBalance(orderId, input, options) {
      const data = await transport.request(`/store/orders/${orderId}/payments`, {
        method: "POST",
        query: { key: options.key },
        auth: "optional",
        module: "split_payments",
        body: {
          gateway_id: input.gatewayId,
          ...(input.amount !== undefined ? { amount: typeof input.amount === "number" ? input.amount : input.amount.amount } : {}),
          ...(input.paymentData ? { payment_data: input.paymentData } : {}),
        },
      });
      return normalizeAttempt(data, minorUnit());
    },
    async link(token) {
      try {
        const data = record(
          await transport.request(`/store/payment-links/${encodeURIComponent(token)}`, { module: "split_payments", fetchOptions: { cache: "no-store" } }),
        );
        const order = record(data.order);
        const currency: CurrencyInfo = { code: String(order.currency || "USD"), minor_unit: minorUnit() };
        const money = (amount: unknown): Money => moneyFromMinor(amount ?? 0, currency) ?? moneyFromMinor(0, currency)!;
        return {
          order: {
            number: String(order.number ?? ""),
            createdAt: text(order.created_at),
            total: money(order.total),
            paid: money(order.paid),
            remaining: money(order.remaining),
            items: (Array.isArray(order.items) ? order.items : []).map((item) => ({
              name: String(record(item).name ?? ""),
              quantity: Number(record(item).quantity) || 0,
              total: money(record(item).total),
              image: text(record(item).image),
            })),
          },
          amount: money(data.amount),
          fixed: data.fixed === true,
          payable: data.payable === true,
          methods: (Array.isArray(data.methods) ? data.methods : []).map((method) => normalizeMethodOption(method, currency)),
          payments: (Array.isArray(data.payments) ? data.payments : []).map((payment) => normalizeOrderPayment(payment, currency)),
          expiresAt: text(data.expires_at),
        };
      } catch (error) {
        if (isHeadpressError(error, "headpress_not_found")) return null;
        throw error;
      }
    },
    async payLink(token, input) {
      const data = await transport.request(`/store/payment-links/${encodeURIComponent(token)}/pay`, {
        method: "POST",
        module: "split_payments",
        body: { gateway_id: input.gatewayId, ...(input.paymentData ? { payment_data: input.paymentData } : {}) },
      });
      return normalizeAttempt(data, minorUnit());
    },
  };
}

/* ------------------------------------------------------------------ */
/* Gateway adapters                                                    */
/* ------------------------------------------------------------------ */

/**
 * How a storefront turns what the shopper typed (a card, an installment choice) into the
 * `payment_data` a gateway expects. Adapters match methods by the server's `kind` and id, never by a
 * guess, and live where the gateway knowledge lives — usually the store's own plugin.
 *
 * @example
 * const mercadoPagoCard = definePaymentAdapter({
 *   match: (method) => method.kind === "card" && method.id === "woo-mercado-pago-custom",
 *   paymentData: async (input, method) => [{ key: "mp_token", value: await tokenize(input, method.publishableKey) }],
 * });
 */
export interface PaymentAdapter<Input = unknown> {
  match(method: { id: string; kind: string }): boolean;
  paymentData(input: Input, method: { id: string; kind: string; publishableKey: string | null; config: Record<string, unknown> }): Promise<readonly { key: string; value: string }[]>;
}

export function definePaymentAdapter<Input>(adapter: PaymentAdapter<Input>): PaymentAdapter<Input> {
  return adapter;
}

/** The `payment_data` for a method from the first adapter that matches, or `[]` when none does. */
export async function resolvePaymentData<Input>(
  adapters: readonly PaymentAdapter<Input>[],
  method: { id: string; kind: string; publishableKey: string | null; config: Record<string, unknown> },
  input: Input,
): Promise<readonly { key: string; value: string }[]> {
  const adapter = adapters.find((candidate) => candidate.match(method));
  return adapter ? adapter.paymentData(input, method) : [];
}
