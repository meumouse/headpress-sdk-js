/**
 * Checkout through the WooCommerce Store API, with Headpress's extensions.
 *
 * - `paymentMethods()` — gateways with the server's own description of each: its kind (`pix`,
 *   `card`, `boleto`…), installment rules, discount rule, publishable key. The storefront never
 *   guesses a kind from a gateway id; an unknown one is `other`.
 * - `place()` — `POST /wc/store/v1/checkout`, building `extensions.headpress` (checkout fields,
 *   attribution, consent, captcha, address book choice, split legs) from plain options.
 * - `retryPayment()` — pay an order that failed with another method, without creating a new one.
 * - `quoteSplit()` — the server's amounts for a split plan, from the same code the checkout uses.
 * - `shippingQuote()` / `installments()` — quotes for the product page.
 */
import { currencyFromStore } from "./catalog.js";
import type { Address } from "./cart.js";
import type { CartTokenStore } from "./cart-token.js";
import { moneyFromMinor, type CurrencyInfo, type Money } from "./money.js";
import { normalizeMethodOption, paymentDetailsRecord, paymentInstructions, type PaymentInstructions, type PaymentMethodOption } from "./payments.js";
import type { StoreAddress, StoreCurrency } from "./store-api.js";
import type { Transport } from "./transport.js";

export interface PaymentMethod {
  id: string;
  title: string;
  description: string;
  icon: string | null;
  orderButtonText: string;
  supports: string[];
  /** From the server (`config.kind`); `other` when the server does not say. */
  kind: string;
  asyncConfirmation: boolean;
  supportsRedirect: boolean;
  supportsTokenization: boolean;
  publishableKey: string | null;
  installments: { max: number; interestFreeUpTo: number; monthlyRatePercent: number } | null;
  discount: PaymentMethodOption["discount"];
  /** The customer's saved methods for this gateway, when signed in. */
  savedMethods: Record<string, unknown>[];
  /** The whole `config` object, for gateway-specific keys. */
  config: Record<string, unknown>;
}

export interface CheckoutDraft {
  orderId: number;
  status: string;
  orderKey: string;
  billingAddress: Address;
  shippingAddress: Address;
  paymentMethod: string;
  extensions: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface PlaceOrderInput {
  billingAddress: Partial<Address>;
  shippingAddress?: Partial<Address>;
  paymentMethod: string;
  /** What the gateway's checkout sends (`[{ key, value }]` or a flat object). */
  paymentData?: readonly { key: string; value: string }[] | Record<string, string>;
  customerNote?: string;
  createAccount?: boolean;
  /** Values of checkout fields Headpress manages (e.g. `brazilianMarketValues()` from `/br`). */
  fields?: Record<string, string>;
  /** Visit attribution keys (`createAttribution()` from `/analytics`). */
  attribution?: Record<string, string | null>;
  /** Consent the shopper gave. */
  consent?: { version: number | null; categories: readonly string[] };
  /** reCAPTCHA token when the captcha module protects the checkout. */
  captcha?: string;
  /** Saved address ids (`address_book`). */
  addressBook?: { shipping_address_id?: string | null; billing_address_id?: string | null };
  /** Split legs, with `paymentMethod` set to the split gateway (`config.modules.split_payments.gateway_id`). */
  splitLegs?: readonly SplitLeg[];
  /** Other extension data, by namespace (merged with `headpress`). */
  extensions?: Record<string, Record<string, unknown>>;
  /** Additional checkout fields of WooCommerce's own Additional Checkout Fields API. */
  additionalFields?: Record<string, unknown>;
}

export interface SplitLeg {
  gatewayId: string;
  amount: Money | number;
  paymentData?: readonly { key: string; value: string }[];
}

export interface PlacedOrder {
  orderId: number;
  orderKey: string;
  status: string;
  paymentStatus: "success" | "pending" | "failure" | "error" | (string & {});
  /** Gateway data as a flat map. */
  paymentDetails: Record<string, string>;
  /** Pix code or bank slip, when the gateway answered one. */
  instructions: PaymentInstructions | null;
  redirectUrl: string | null;
  /** Per-leg results of a split checkout. */
  splitLegs: { gatewayId: string; amount: Money; status: string; message: string; instructions: PaymentInstructions | null; redirectUrl: string | null }[];
  extensions: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface SplitQuote {
  total: Money;
  legs: { gatewayId: string; kind: string; amount: Money; discount: Money; charge: Money }[];
  discountTotal: Money;
  chargeTotal: Money;
}

export interface ShippingQuote {
  rates: { id: string; methodId: string; instanceId: number; label: string; cost: Money; taxes: Money; deliveryTime: { min: number; max: number; unit: string } | null; meta: Record<string, unknown> }[];
  freeShipping: { threshold: Money; remaining: Money } | null;
}

export interface InstallmentPlan {
  count: number;
  amount: Money;
  total: Money;
  interest: Money;
  hasInterest: boolean;
}

export interface Checkout {
  /** Gateways and how each works, from the server. */
  paymentMethods(options?: { signal?: AbortSignal }): Promise<PaymentMethod[]>;
  /** The checkout draft for the current cart. */
  get(): Promise<CheckoutDraft>;
  place(input: PlaceOrderInput): Promise<PlacedOrder>;
  /** Pay a failed or pending order again with the same or another method. */
  retryPayment(orderId: number, input: { key: string; billingEmail?: string; billingAddress?: Partial<Address>; paymentMethod: string; paymentData?: PlaceOrderInput["paymentData"] }): Promise<PlacedOrder>;
  /** The server's amounts for a split plan (Headpress 1.3+). */
  quoteSplit(legs: readonly { gatewayId: string; amount: Money | number }[]): Promise<SplitQuote>;
  /** Shipping rates for a product before it is in the cart (Headpress 1.3+). */
  shippingQuote(input: { productId: number; variationId?: number; quantity?: number; postcode: string; country?: string; state?: string; city?: string }): Promise<ShippingQuote>;
  /** Installment plans for a product (`installments` module). */
  installments(productId: number, price?: Money | number): Promise<{ plans: InstallmentPlan[]; bestWithoutInterest: InstallmentPlan | null; bestWithInterest: InstallmentPlan | null }>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function minor(value: Money | number): number {
  return typeof value === "number" ? value : value.amount;
}

function paymentDataList(data: PlaceOrderInput["paymentData"]): { key: string; value: string }[] {
  if (!data) return [];
  return Array.isArray(data) ? [...data] : Object.entries(data).map(([key, value]) => ({ key, value: String(value) }));
}

export function normalizePaymentMethod(value: unknown, currency: CurrencyInfo): PaymentMethod {
  const data = record(value);
  const config = record(data.config);
  const installments = record(config.installments);
  const rule = record(config.discount_rule);
  const option = normalizeMethodOption(
    {
      id: data.id,
      title: data.title,
      kind: config.kind,
      discount: config.discount_rule
        ? rule.type === "fixed"
          ? { type: "fixed", amount: rule.amount }
          : { type: "percentage", amount: rule.percent ?? rule.amount }
        : null,
    },
    currency,
  );
  return {
    id: String(data.id ?? ""),
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    icon: text(data.icon) ?? text(config.icon_url),
    orderButtonText: String(data.order_button_text ?? ""),
    supports: Array.isArray(data.supports) ? data.supports.map(String) : [],
    kind: typeof config.kind === "string" && config.kind ? config.kind : "other",
    asyncConfirmation: config.async_confirmation === true,
    supportsRedirect: config.supports_redirect === true,
    supportsTokenization: config.supports_tokenization === true,
    publishableKey: text(config.publishable_key),
    installments: config.installments
      ? {
          max: Number(installments.max) || 1,
          interestFreeUpTo: Number(installments.interest_free_up_to) || 1,
          monthlyRatePercent: Number(installments.monthly_rate_percent) || 0,
        }
      : null,
    discount: option.discount,
    savedMethods: Array.isArray(data.saved_methods) ? (data.saved_methods as Record<string, unknown>[]) : [],
    config,
  };
}

function normalizePlaced(value: unknown, minorUnit: number): PlacedOrder {
  const data = record(value);
  const result = record(data.payment_result);
  const details = paymentDetailsRecord(result.payment_details as { key: string; value: string }[]);
  const split = record(record(record(data.extensions).headpress).split_payments);
  const currency: CurrencyInfo = { code: String(record(data.totals).currency_code ?? "USD"), minor_unit: minorUnit };
  return {
    orderId: Number(data.order_id) || 0,
    orderKey: String(data.order_key ?? ""),
    status: String(data.status ?? ""),
    paymentStatus: String(result.payment_status ?? ""),
    paymentDetails: details,
    instructions: paymentInstructions({ details, redirectUrl: text(result.redirect_url) }),
    redirectUrl: text(result.redirect_url),
    splitLegs: (Array.isArray(split.legs) ? split.legs : []).map((leg) => {
      const entry = record(leg);
      return {
        gatewayId: String(entry.gateway_id ?? ""),
        amount: moneyFromMinor(entry.amount, currency) ?? moneyFromMinor(0, currency)!,
        status: String(entry.status ?? ""),
        message: String(entry.message ?? ""),
        instructions: paymentInstructions({ details: entry.payment_details as Record<string, unknown>, kind: String(record(entry.payment).kind ?? "") }),
        redirectUrl: text(entry.redirect_url),
      };
    }),
    extensions: record(data.extensions),
    raw: data,
  };
}

export function createCheckout(transport: Transport, cartToken: CartTokenStore | undefined, currency: () => CurrencyInfo): Checkout {
  const store = { api: "store" as const, cartToken: true, auth: "optional" as const };

  return {
    async paymentMethods(options = {}) {
      const data = await transport.request<unknown[]>("/store/checkout/payment-methods", {
        module: "woocommerce",
        cacheTags: ["headpress:config"],
        signal: options.signal,
        auth: "optional",
      });
      return (Array.isArray(data) ? data : []).map((method) => normalizePaymentMethod(method, currency()));
    },

    async get() {
      if (cartToken && !cartToken.get()) await transport.request("/cart", store);
      const data = record(await transport.request("/checkout", store));
      return {
        orderId: Number(data.order_id) || 0,
        status: String(data.status ?? ""),
        orderKey: String(data.order_key ?? ""),
        billingAddress: data.billing_address as StoreAddress,
        shippingAddress: data.shipping_address as StoreAddress,
        paymentMethod: String(data.payment_method ?? ""),
        extensions: record(data.extensions),
        raw: data,
      };
    },

    async place(input) {
      const headpress: Record<string, unknown> = { ...(input.extensions?.headpress ?? {}) };
      if (input.fields && Object.keys(input.fields).length) headpress.checkout_fields = { values: input.fields };
      if (input.attribution) headpress.attribution = input.attribution;
      if (input.consent) headpress.consent = { version: input.consent.version, categories: [...input.consent.categories] };
      if (input.captcha) headpress.captcha = { token: input.captcha };
      if (input.addressBook) headpress.address_book = input.addressBook;
      if (input.splitLegs) {
        headpress.split_payments = {
          legs: input.splitLegs.map((leg) => ({
            gateway_id: leg.gatewayId,
            amount: minor(leg.amount),
            ...(leg.paymentData ? { payment_data: leg.paymentData } : {}),
          })),
        };
      }
      const extensions: Record<string, unknown> = { ...(input.extensions ?? {}) };
      if (Object.keys(headpress).length) extensions.headpress = headpress;

      const data = await transport.request("/checkout", {
        ...store,
        method: "POST",
        body: {
          billing_address: input.billingAddress,
          shipping_address: input.shippingAddress ?? input.billingAddress,
          payment_method: input.paymentMethod,
          payment_data: paymentDataList(input.paymentData),
          ...(input.customerNote ? { customer_note: input.customerNote } : {}),
          ...(input.createAccount ? { create_account: true } : {}),
          ...(input.additionalFields ? { additional_fields: input.additionalFields } : {}),
          ...(Object.keys(extensions).length ? { extensions } : {}),
        },
      });
      return normalizePlaced(data, currency().minor_unit ?? 2);
    },

    async retryPayment(orderId, input) {
      const data = await transport.request(`/checkout/${orderId}`, {
        api: "store",
        auth: "optional",
        method: "POST",
        body: {
          key: input.key,
          ...(input.billingEmail ? { billing_email: input.billingEmail } : {}),
          ...(input.billingAddress ? { billing_address: input.billingAddress } : {}),
          payment_method: input.paymentMethod,
          payment_data: paymentDataList(input.paymentData),
        },
      });
      return normalizePlaced(data, currency().minor_unit ?? 2);
    },

    async quoteSplit(legs) {
      const data = record(
        await transport.request("/store/split-payments/quote", {
          method: "POST",
          cartToken: true,
          auth: "optional",
          module: "split_payments",
          body: { legs: legs.map((leg) => ({ gateway: leg.gatewayId, amount: minor(leg.amount) })) },
        }),
      );
      const quoteCurrency: CurrencyInfo = { ...currency(), code: String(data.currency || currency().code) };
      const money = (value: unknown): Money => moneyFromMinor(value ?? 0, quoteCurrency) ?? moneyFromMinor(0, quoteCurrency)!;
      return {
        total: money(data.total),
        legs: (Array.isArray(data.legs) ? data.legs : []).map((leg) => {
          const entry = record(leg);
          return {
            gatewayId: String(entry.gateway ?? entry.gateway_id ?? ""),
            kind: String(entry.kind ?? "other"),
            amount: money(entry.amount),
            discount: money(entry.discount),
            charge: money(entry.charge),
          };
        }),
        discountTotal: money(data.discount_total),
        chargeTotal: money(data.charge_total),
      };
    },

    async shippingQuote(input) {
      const data = record(
        await transport.request("/store/shipping/quote", {
          method: "POST",
          module: "woocommerce",
          body: {
            product_id: input.productId,
            ...(input.variationId ? { variation_id: input.variationId } : {}),
            quantity: input.quantity ?? 1,
            postcode: input.postcode,
            ...(input.country ? { country: input.country } : {}),
            ...(input.state ? { state: input.state } : {}),
            ...(input.city ? { city: input.city } : {}),
          },
        }),
      );
      const quoteCurrency: CurrencyInfo = { ...currency(), code: String(data.currency || currency().code) };
      const money = (value: unknown): Money => moneyFromMinor(value ?? 0, quoteCurrency) ?? moneyFromMinor(0, quoteCurrency)!;
      const free = record(data.free_shipping);
      return {
        rates: (Array.isArray(data.rates) ? data.rates : []).map((rate) => {
          const entry = record(rate);
          const delivery = record(entry.delivery_time);
          return {
            id: String(entry.id ?? ""),
            methodId: String(entry.method_id ?? ""),
            instanceId: Number(entry.instance_id) || 0,
            label: String(entry.label ?? ""),
            cost: money(entry.cost),
            taxes: money(entry.taxes),
            deliveryTime: entry.delivery_time ? { min: Number(delivery.min) || 0, max: Number(delivery.max) || 0, unit: String(delivery.unit ?? "days") } : null,
            meta: record(entry.meta),
          };
        }),
        freeShipping: data.free_shipping ? { threshold: money(free.threshold), remaining: money(free.remaining) } : null,
      };
    },

    async installments(productId, price) {
      const data = record(
        await transport.request("/store/installments/simulate", {
          query: { product_id: productId, price: price === undefined ? undefined : minor(price) },
          module: "installments",
          cacheTags: [`product:${productId}`],
        }),
      );
      const money = (value: unknown): Money => moneyFromMinor(value ?? 0, currency()) ?? moneyFromMinor(0, currency())!;
      const plan = (value: unknown): InstallmentPlan | null => {
        const entry = record(value);
        if (!entry.count) return null;
        return {
          count: Number(entry.count) || 0,
          amount: money(entry.amount),
          total: money(entry.total),
          interest: money(entry.interest_fee),
          hasInterest: entry.has_interest === true,
        };
      };
      return {
        plans: (Array.isArray(data.installments) ? data.installments : []).map(plan).filter((entry): entry is InstallmentPlan => entry !== null),
        bestWithoutInterest: plan(data.best_without_interest),
        bestWithInterest: plan(data.best_with_interest),
      };
    },
  };
}

/** The store currency for checkout amounts: the config's, else the cart's, else BRL with 2 decimals. */
export function checkoutCurrency(commerce: { code: string; minor_unit: number } | undefined, cart?: StoreCurrency): CurrencyInfo {
  if (commerce) return { code: commerce.code, minor_unit: commerce.minor_unit };
  if (cart) return currencyFromStore(cart);
  return { code: "BRL", minor_unit: 2 };
}

