/**
 * The cart, through the WooCommerce Store API, identified by the `Cart-Token`.
 *
 * - The first mutation without a token fetches the cart first to get one (the Store API refuses
 *   writes that carry neither a Cart-Token nor a nonce).
 * - A token the Store API no longer accepts is replaced and the call replayed once.
 * - Every answer that carries a cart — including error answers, which often do — updates the
 *   cart held by the client and notifies subscribers, so every widget shows the same cart.
 * - Signed-in customers' calls carry their access token (`auth: "optional"`).
 *
 * Totals, discounts, fees, shipping and the free-shipping progress are the server's numbers.
 */
import { currencyFromStore, storeMoney, type ProductImage } from "./catalog.js";
import type { CartTokenStore } from "./cart-token.js";
import { HeadpressError, isHeadpressError } from "./errors.js";
import { moneyFromMinor, type CurrencyInfo, type Money } from "./money.js";
import { decodeHtmlEntities } from "./seo.js";
import type { StoreAddress, StoreCart, StoreCartItem, StoreShippingPackage } from "./store-api.js";
import type { RequestOptions, Transport } from "./transport.js";

export type Address = StoreAddress;

export interface CartItem {
  key: string;
  /** Product or variation id. */
  id: number;
  type: string;
  name: string;
  sku: string;
  quantity: number;
  /** What the Store API accepts for this line. `editable: false` for fixed quantities. */
  quantityLimits: { min: number; max: number | null; step: number; editable: boolean };
  images: ProductImage[];
  permalink: string;
  /** Chosen variation attributes. */
  variation: { attribute: string; value: string }[];
  /** Extra lines plugins attach (personalization, gift wrap…). */
  itemData: { name: string; value: string }[];
  unitPrice: Money;
  regularPrice: Money;
  salePrice: Money;
  /** Line total before discounts. */
  subtotal: Money;
  /** Line total after discounts. */
  total: Money;
  lowStockRemaining: number | null;
  soldIndividually: boolean;
  backordersAllowed: boolean;
  extensions: Record<string, unknown>;
}

export interface ShippingRate {
  id: string;
  packageId: number | string;
  name: string;
  description: string;
  deliveryTime: string;
  price: Money;
  taxes: Money;
  methodId: string;
  instanceId: number;
  selected: boolean;
  meta: Record<string, unknown>;
}

export interface ShippingPackage {
  id: number | string;
  name: string;
  destination: Partial<Address>;
  items: { key: string; name: string; quantity: number }[];
  rates: ShippingRate[];
}

export interface FreeShippingProgress {
  threshold: Money;
  subtotal: Money;
  remaining: Money;
  qualifies: boolean;
  hasFreeRate: boolean;
}

export interface Cart {
  items: CartItem[];
  itemsCount: number;
  itemsWeight: number;
  coupons: { code: string; type: string; discount: Money }[];
  fees: { id: string; name: string; total: Money }[];
  currency: CurrencyInfo;
  totals: {
    /** Items before discounts. */
    subtotal: Money;
    discount: Money;
    fees: Money;
    /** Null until shipping has been calculated. */
    shipping: Money | null;
    tax: Money;
    total: Money;
  };
  shippingPackages: ShippingPackage[];
  needsShipping: boolean;
  needsPayment: boolean;
  hasCalculatedShipping: boolean;
  /** From Headpress (`extensions.headpress.shipping.free_shipping`), when the store offers it. */
  freeShipping: FreeShippingProgress | null;
  billingAddress: Address;
  shippingAddress: Address;
  paymentMethods: string[];
  errors: { code: string; message: string }[];
  extensions: Record<string, unknown>;
  raw: StoreCart;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeItem(raw: StoreCartItem): CartItem {
  const currency = currencyFromStore(raw.prices);
  const limits = raw.quantity_limits ?? { minimum: 1, maximum: 9999, multiple_of: 1, editable: true };
  return {
    key: raw.key,
    id: raw.id,
    type: raw.type ?? "simple",
    name: decodeHtmlEntities(raw.name ?? ""),
    sku: raw.sku ?? "",
    quantity: raw.quantity,
    quantityLimits: {
      min: limits.minimum,
      max: limits.maximum >= 9999 ? null : limits.maximum,
      step: limits.multiple_of || 1,
      editable: limits.editable !== false,
    },
    images: (raw.images ?? []).map((image) => ({
      id: image.id,
      src: image.src,
      thumbnail: image.thumbnail,
      srcset: image.srcset,
      sizes: image.sizes,
      alt: decodeHtmlEntities(image.alt ?? ""),
      name: decodeHtmlEntities(image.name ?? ""),
    })),
    permalink: raw.permalink,
    variation: (raw.variation ?? []).map((entry) => ({
      attribute: decodeHtmlEntities(entry.attribute),
      value: decodeHtmlEntities(entry.value),
    })),
    itemData: (raw.item_data ?? [])
      .filter((entry) => !entry.hidden)
      .map((entry) => ({
        name: decodeHtmlEntities(entry.name ?? entry.key ?? ""),
        value: decodeHtmlEntities(entry.display ?? entry.value ?? ""),
      })),
    unitPrice: storeMoney(raw.prices.price, currency),
    regularPrice: storeMoney(raw.prices.regular_price, currency),
    salePrice: storeMoney(raw.prices.sale_price, currency),
    subtotal: storeMoney(raw.totals.line_subtotal, currency),
    total: storeMoney(raw.totals.line_total, currency),
    lowStockRemaining: raw.low_stock_remaining ?? null,
    soldIndividually: raw.sold_individually === true,
    backordersAllowed: raw.backorders_allowed === true,
    extensions: raw.extensions ?? {},
  };
}

function normalizePackage(raw: StoreShippingPackage): ShippingPackage {
  return {
    id: raw.package_id,
    name: decodeHtmlEntities(raw.name ?? ""),
    destination: raw.destination ?? {},
    items: raw.items ?? [],
    rates: (raw.shipping_rates ?? []).map((rate) => {
      const currency = currencyFromStore(rate);
      return {
        id: rate.rate_id,
        packageId: raw.package_id,
        name: decodeHtmlEntities(rate.name ?? ""),
        description: decodeHtmlEntities(rate.description ?? ""),
        deliveryTime: rate.delivery_time ?? "",
        price: storeMoney(rate.price, currency),
        taxes: storeMoney(rate.taxes, currency),
        methodId: rate.method_id,
        instanceId: rate.instance_id,
        selected: rate.selected === true,
        meta: Object.fromEntries((rate.meta_data ?? []).map((entry) => [entry.key, entry.value])),
      };
    }),
  };
}

export function normalizeCart(raw: StoreCart): Cart {
  const currency = currencyFromStore(raw.totals);
  const money = (value: unknown): Money => storeMoney(value, currency);
  const shipping = record(record(raw.extensions?.headpress)?.shipping);
  const free = record(shipping?.free_shipping);
  const threshold = free ? moneyFromMinor(free.threshold, currency) : null;

  return {
    items: (raw.items ?? []).map(normalizeItem),
    itemsCount: raw.items_count ?? 0,
    itemsWeight: raw.items_weight ?? 0,
    coupons: (raw.coupons ?? []).map((coupon) => ({
      code: coupon.code,
      type: coupon.discount_type,
      discount: money(coupon.totals?.total_discount),
    })),
    fees: (raw.fees ?? []).map((fee) => ({ id: fee.id, name: decodeHtmlEntities(fee.name ?? ""), total: money(fee.totals?.total) })),
    currency,
    totals: {
      subtotal: money(raw.totals.total_items),
      discount: money(raw.totals.total_discount),
      fees: money(raw.totals.total_fees),
      shipping: raw.totals.total_shipping === null ? null : money(raw.totals.total_shipping),
      tax: money(raw.totals.total_tax),
      total: money(raw.totals.total_price),
    },
    shippingPackages: (raw.shipping_rates ?? []).map(normalizePackage),
    needsShipping: raw.needs_shipping === true,
    needsPayment: raw.needs_payment === true,
    hasCalculatedShipping: raw.has_calculated_shipping === true,
    freeShipping:
      free && free.enabled !== false && threshold
        ? {
            threshold,
            subtotal: money(free.subtotal),
            remaining: money(free.remaining),
            qualifies: free.qualifies === true,
            hasFreeRate: free.has_free_rate === true,
          }
        : null,
    billingAddress: raw.billing_address,
    shippingAddress: raw.shipping_address,
    paymentMethods: raw.payment_methods ?? [],
    errors: raw.errors ?? [],
    extensions: raw.extensions ?? {},
    raw,
  };
}

/** Whether something looks like a Store API cart (used to pick carts out of error data). */
function isStoreCart(value: unknown): value is StoreCart {
  const data = record(value);
  return Boolean(data && Array.isArray(data.items) && record(data.totals));
}

export interface AddItemInput {
  /** Product or variation id. */
  id: number;
  quantity?: number;
  /** Attribute values for variable products added by parent id. */
  variation?: readonly { attribute: string; value: string }[];
  /** Extension data plugins read on add-to-cart (personalization…). */
  extensions?: Record<string, unknown>;
}

export interface CartOptions {
  /** Error codes after which the Cart-Token is replaced and the call replayed once. */
  renewTokenOn?: readonly string[];
}

export interface CartResource {
  /** Fetch the cart (and a Cart-Token, when there is none yet). */
  get(options?: { signal?: AbortSignal }): Promise<Cart>;
  addItem(input: AddItemInput): Promise<Cart>;
  updateItem(key: string, quantity: number): Promise<Cart>;
  removeItem(key: string): Promise<Cart>;
  /** Empty the cart. */
  clear(): Promise<Cart>;
  applyCoupon(code: string): Promise<Cart>;
  removeCoupon(code: string): Promise<Cart>;
  /** Set addresses; the Store API recalculates shipping and taxes. */
  updateCustomer(input: { billing_address?: Partial<Address>; shipping_address?: Partial<Address> }): Promise<Cart>;
  selectShippingRate(packageId: number | string, rateId: string): Promise<Cart>;
  /** A cart action registered by a plugin (`POST /cart/extensions`), e.g. `("headpress", { action: "address_book.apply", … })`. */
  action(namespace: string, data: Record<string, unknown>): Promise<Cart>;
  /** The last cart seen, without fetching. */
  peek(): Cart | null;
  subscribe(listener: (cart: Cart) => void): () => void;
}

const DEFAULT_RENEW = ["woocommerce_rest_missing_nonce", "woocommerce_rest_invalid_nonce"];

export function createCartResource(
  transport: Transport,
  cartToken: CartTokenStore | undefined,
  options: CartOptions = {},
): CartResource {
  const renewOn = new Set(options.renewTokenOn ?? DEFAULT_RENEW);
  let current: Cart | null = null;
  const listeners = new Set<(cart: Cart) => void>();

  const accept = (raw: StoreCart): Cart => {
    current = normalizeCart(raw);
    const snapshot = current;
    listeners.forEach((listener) => listener(snapshot));
    return snapshot;
  };

  const base: RequestOptions = { api: "store", cartToken: true, auth: "optional" };

  const fetchCart = async (signal?: AbortSignal): Promise<Cart> =>
    accept(await transport.request<StoreCart>("/cart", { ...base, signal }));

  async function mutate(path: string, init: Pick<RequestOptions, "method" | "body" | "query">): Promise<Cart> {
    if (cartToken && !cartToken.get()) await fetchCart();
    const send = () => transport.request<StoreCart | unknown>(path, { ...base, ...init });

    let data: unknown;
    try {
      data = await send();
    } catch (error) {
      if (isHeadpressError(error) && renewOn.has(error.code) && cartToken) {
        cartToken.set(null);
        await fetchCart();
        data = await send();
      } else {
        // Store API errors often carry the cart as it is now (a coupon that no longer applies…).
        if (isHeadpressError(error) && isStoreCart(error.data.cart)) accept(error.data.cart);
        throw error;
      }
    }
    if (isStoreCart(data)) return accept(data);
    // Routes that answer with something else (DELETE /cart/items answers []): read the cart.
    return fetchCart();
  }

  return {
    get: (getOptions = {}) => fetchCart(getOptions.signal),
    addItem: (input) =>
      mutate("/cart/add-item", {
        method: "POST",
        body: {
          id: input.id,
          quantity: input.quantity ?? 1,
          ...(input.variation ? { variation: input.variation } : {}),
          ...(input.extensions ? { extensions: input.extensions } : {}),
        },
      }),
    updateItem: (key, quantity) => {
      if (!Number.isInteger(quantity) || quantity < 0) {
        return Promise.reject(new HeadpressError("headpress_invalid_param", "Quantity must be a whole number.", 400));
      }
      return quantity === 0
        ? mutate("/cart/remove-item", { method: "POST", body: { key } })
        : mutate("/cart/update-item", { method: "POST", body: { key, quantity } });
    },
    removeItem: (key) => mutate("/cart/remove-item", { method: "POST", body: { key } }),
    clear: () => mutate("/cart/items", { method: "DELETE" }),
    applyCoupon: (code) => mutate("/cart/apply-coupon", { method: "POST", body: { code: code.trim() } }),
    removeCoupon: (code) => mutate("/cart/remove-coupon", { method: "POST", body: { code } }),
    updateCustomer: (input) => mutate("/cart/update-customer", { method: "POST", body: input }),
    selectShippingRate: (packageId, rateId) =>
      mutate("/cart/select-shipping-rate", { method: "POST", body: { package_id: packageId, rate_id: rateId } }),
    action: (namespace, data) => mutate("/cart/extensions", { method: "POST", body: { namespace, data } }),
    peek: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

