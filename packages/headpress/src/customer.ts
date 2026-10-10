/**
 * The signed-in customer's account: profile, password, orders, downloads, login phone, e-mail
 * verification, Google link, wishlist, address book, saved payment methods and own reviews.
 *
 * Every call needs a session (`auth: "required"`) and fails with `headpress_not_authenticated`
 * without one. Calls for modules the store turned off fail with `headpress_module_disabled`.
 * Addresses and payment methods are not tied to one module: an add-on may serve the same routes
 * (e.g. a predecessor of `address_book`), so the server decides (`rest_no_route` when nobody does).
 */
import type {
  Customer,
  GoogleAccount,
  OrderDetail,
  OrderItem,
  OrderSummary,
  OtpChallenge,
  PhoneState,
  SavedAddress,
  SavedAddressInput,
  SavedPaymentMethod,
  Wishlist,
  WishlistProduct,
} from "./account-types.js";
import { moneyFromMinor, type CurrencyInfo, type Money } from "./money.js";
import type { Review } from "./reviews.js";
import { normalizeReview } from "./reviews.js";
import { isBffSession, type BffSessionBody } from "./session-bff.js";
import type { TokenStore } from "./session.js";
import type { RequestOptions, Transport } from "./transport.js";

export interface CustomerUpdate {
  first_name?: string;
  last_name?: string;
  display_name?: string;
  /** Changes the login e-mail; needs `current_password` (or `google_credential`). */
  email?: string;
  current_password?: string;
  google_credential?: string;
  billing?: Record<string, string>;
  shipping?: Record<string, string>;
  /** Fields add-on modules accept. */
  [key: string]: unknown;
}

export interface Page<T> {
  items: T[];
  total: number;
  totalPages: number;
}

export interface CustomerResource {
  me(): Promise<Customer>;
  update(input: CustomerUpdate): Promise<Customer>;
  /** Change the password; every other session ends and this one gets new tokens. */
  changePassword(input: { password: string; current_password?: string }): Promise<Customer | null>;
  orders: {
    list(query?: { page?: number; perPage?: number; status?: readonly string[] }): Promise<Page<OrderSummary>>;
    get(id: number): Promise<OrderDetail>;
  };
  downloads(): Promise<Record<string, unknown>[]>;
  phone: {
    /** Link the phone a code verified at sign-up (`registrationToken` from `otp.verify`). */
    link(registrationToken: string): Promise<PhoneState>;
    start(input: { phone: string; channel?: string; current_password?: string; google_credential?: string }, options?: { captcha?: string }): Promise<OtpChallenge>;
    verify(input: { challengeId: string; code: string }): Promise<PhoneState>;
    resend(challengeId: string): Promise<OtpChallenge>;
    remove(): Promise<void>;
  };
  emailVerification: {
    start(): Promise<{ sent: boolean; email_verified: boolean; email_verified_at: string | null }>;
    verify(code: string): Promise<{ email_verified: boolean; email_verified_at: string | null }>;
  };
  google: {
    link(credential: string, options?: { current_password?: string }): Promise<GoogleAccount>;
    unlink(): Promise<void>;
  };
  wishlist: {
    get(): Promise<Wishlist>;
    add(productId: number): Promise<Wishlist>;
    remove(productId: number): Promise<Wishlist>;
  };
  addresses: {
    list(): Promise<SavedAddress[]>;
    create(input: SavedAddressInput): Promise<{ address: SavedAddress; addresses: SavedAddress[] }>;
    update(id: string, input: SavedAddressInput): Promise<{ address: SavedAddress; addresses: SavedAddress[] }>;
    remove(id: string): Promise<SavedAddress[]>;
  };
  paymentMethods: {
    list(): Promise<SavedPaymentMethod[]>;
    setDefault(id: string): Promise<SavedPaymentMethod[]>;
    remove(id: string): Promise<SavedPaymentMethod[]>;
    /** Start adding a card where the gateway allows it (`config.modules.saved_payment_methods.allow_add`). */
    setup(gatewayId: string): Promise<{ gateway_id: string; requires_cvc: boolean; client: Record<string, unknown> }>;
    add(input: { gatewayId: string; paymentData: readonly { key: string; value: string }[] }, options?: { captcha?: string }): Promise<{ payment_method: SavedPaymentMethod; payment_methods: SavedPaymentMethod[] }>;
  };
  reviews: {
    list(): Promise<(Review & { status?: string; editable_until?: string | null; product?: Record<string, unknown> })[]>;
    /** Products bought and not reviewed yet. */
    pending(): Promise<Record<string, unknown>[]>;
    update(id: number, input: { rating?: number; title?: string; content?: string }): Promise<Review>;
    remove(id: number): Promise<void>;
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function money(value: unknown, currency: CurrencyInfo): Money {
  return moneyFromMinor(value, currency) ?? moneyFromMinor(0, currency)!;
}

export function normalizeOrderSummary(raw: Record<string, unknown>, minorUnit = 2): OrderSummary {
  const currency: CurrencyInfo = { code: String(raw.currency || "USD"), minor_unit: minorUnit };
  return { ...(raw as unknown as OrderSummary), total: money(raw.total, currency) };
}

export function normalizeOrder(raw: Record<string, unknown>, minorUnit = 2): OrderDetail {
  const currency: CurrencyInfo = { code: String(raw.currency || "USD"), minor_unit: minorUnit };
  const totals = record(raw.totals);
  return {
    ...(raw as unknown as OrderDetail),
    total: money(raw.total, currency),
    totals: {
      subtotal: money(totals.subtotal, currency),
      discount: money(totals.discount, currency),
      shipping: money(totals.shipping, currency),
      tax: money(totals.tax, currency),
      fees: money(totals.fees, currency),
      total: money(totals.total, currency),
      refunded: money(totals.refunded, currency),
    },
    shipping_lines: (Array.isArray(raw.shipping_lines) ? raw.shipping_lines : []).map((line) => ({
      ...(record(line) as unknown as OrderDetail["shipping_lines"][number]),
      total: money(record(line).total, currency),
    })),
    items: (Array.isArray(raw.items) ? raw.items : []).map((item) => ({
      ...(record(item) as unknown as OrderItem),
      subtotal: money(record(item).subtotal, currency),
      total: money(record(item).total, currency),
    })),
  };
}

export function normalizeWishlist(raw: unknown): Wishlist {
  const data = record(raw);
  return {
    count: Number(data.count) || 0,
    ids: Array.isArray(data.ids) ? data.ids.filter((id): id is number => typeof id === "number") : [],
    products: (Array.isArray(data.products) ? data.products : []).map((entry) => {
      const product = record(entry);
      const prices = record(product.prices);
      const currency: CurrencyInfo = { code: String(prices.currency_code || "USD"), minor_unit: Number(prices.currency_minor_unit ?? 2) };
      return {
        ...(product as unknown as WishlistProduct),
        price: moneyFromMinor(prices.price, currency),
        regular_price: moneyFromMinor(prices.regular_price, currency),
        sale_price: moneyFromMinor(prices.sale_price, currency),
      };
    }),
  };
}

export function createCustomer(
  transport: Transport,
  session: TokenStore | undefined,
  minorUnit: () => number,
): CustomerResource {
  const viaBff = isBffSession(session) ? session : null;
  const call = <T>(path: string, options: RequestOptions = {}): Promise<T> => transport.request<T>(path, { auth: "required", ...options });

  return {
    me: () => call<Customer>("/store/customers/me", { module: "accounts" }),
    update: (input) => call<Customer>("/store/customers/me", { method: "PUT", body: input, module: "accounts" }),

    async changePassword(input) {
      if (viaBff) {
        const token = session?.getAccessToken() ?? (await session?.refresh?.()) ?? null;
        const body = await viaBff.bff.request<BffSessionBody>("password", input, token ? { Authorization: `Bearer ${token}` } : {});
        viaBff.accept(body);
        return body.customer ?? null;
      }
      const body = await call<{ access_token: string; expires_in: number; refresh_token?: string; refresh_expires_in?: number; customer?: Customer }>(
        "/store/customers/me/password",
        { method: "POST", body: input, module: "accounts" },
      );
      session?.setTokens({
        accessToken: body.access_token,
        expiresIn: body.expires_in,
        refreshToken: body.refresh_token,
        refreshExpiresIn: body.refresh_expires_in,
      });
      return body.customer ?? null;
    },

    orders: {
      async list(query = {}) {
        const response = await transport.raw<Record<string, unknown>[]>("/store/customers/me/orders", {
          auth: "required",
          module: "accounts",
          query: { page: query.page, per_page: query.perPage, status: query.status },
        });
        const items = (Array.isArray(response.data) ? response.data : []).map((raw) => normalizeOrderSummary(raw, minorUnit()));
        return {
          items,
          total: Number(response.headers.get("X-WP-Total") ?? items.length) || 0,
          totalPages: Number(response.headers.get("X-WP-TotalPages") ?? 1) || 0,
        };
      },
      get: async (id) => normalizeOrder(await call<Record<string, unknown>>(`/store/customers/me/orders/${id}`, { module: "accounts" }), minorUnit()),
    },

    downloads: () => call("/store/customers/me/downloads", { module: "accounts" }),

    phone: {
      link: (registrationToken) => call("/store/customers/me/phone/link", { method: "POST", body: { registration_token: registrationToken }, module: "passwordless" }),
      start: (input, options = {}) =>
        call("/store/customers/me/phone/start", { method: "POST", body: { channel: "whatsapp", ...input }, captcha: options.captcha, module: "passwordless" }),
      verify: (input) =>
        call("/store/customers/me/phone/verify", { method: "POST", body: { challenge_id: input.challengeId, code: input.code }, module: "passwordless" }),
      resend: (challengeId) => call("/store/customers/me/phone/resend", { method: "POST", body: { challenge_id: challengeId }, module: "passwordless" }),
      remove: async () => {
        await call("/store/customers/me/phone", { method: "DELETE", module: "passwordless" });
      },
    },

    emailVerification: {
      start: () => call("/store/customers/me/email-verification/start", { method: "POST", body: {}, module: "passwordless" }),
      verify: (code) => call("/store/customers/me/email-verification/verify", { method: "POST", body: { code }, module: "passwordless" }),
    },

    google: {
      link: (credential, options = {}) =>
        call("/store/customers/me/google", { method: "POST", body: { credential, ...options }, module: "google_sign_in" }),
      unlink: async () => {
        await call("/store/customers/me/google", { method: "DELETE", module: "google_sign_in" });
      },
    },

    wishlist: {
      get: async () => normalizeWishlist(await call("/store/customers/me/wishlist", { module: "wishlist" })),
      add: async (productId) =>
        normalizeWishlist(await call("/store/customers/me/wishlist", { method: "POST", body: { product_id: productId }, module: "wishlist" })),
      remove: async (productId) =>
        normalizeWishlist(await call(`/store/customers/me/wishlist/${productId}`, { method: "DELETE", module: "wishlist" })),
    },

    addresses: {
      list: async () => (await call<{ addresses: SavedAddress[] }>("/store/customers/me/addresses", {})).addresses,
      create: (input) => call("/store/customers/me/addresses", { method: "POST", body: input }),
      update: (id, input) => call(`/store/customers/me/addresses/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
      remove: async (id) =>
        (await call<{ addresses: SavedAddress[] }>(`/store/customers/me/addresses/${encodeURIComponent(id)}`, { method: "DELETE" })).addresses,
    },

    paymentMethods: {
      list: async () =>
        (await call<{ payment_methods: SavedPaymentMethod[] }>("/store/customers/me/payment-methods", {})).payment_methods,
      setDefault: async (id) =>
        (
          await call<{ payment_methods: SavedPaymentMethod[] }>(`/store/customers/me/payment-methods/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: { is_default: true },
          })
        ).payment_methods,
      remove: async (id) =>
        (
          await call<{ payment_methods: SavedPaymentMethod[] }>(`/store/customers/me/payment-methods/${encodeURIComponent(id)}`, {
            method: "DELETE",
          })
        ).payment_methods,
      setup: (gatewayId) =>
        call("/store/customers/me/payment-methods/setup", { method: "POST", body: { gateway_id: gatewayId } }),
      add: (input, options = {}) =>
        call("/store/customers/me/payment-methods", {
          method: "POST",
          body: { gateway_id: input.gatewayId, payment_data: input.paymentData },
          captcha: options.captcha,
        }),
    },

    reviews: {
      list: async () =>
        (await call<Record<string, unknown>[]>("/store/customers/me/reviews", { module: "reviews" })).map(
          (raw) => normalizeReview(raw) as Review & { status?: string; editable_until?: string | null },
        ),
      pending: () => call("/store/customers/me/reviews/pending", { module: "reviews" }),
      update: async (id, input) =>
        normalizeReview(await call<Record<string, unknown>>(`/store/customers/me/reviews/${id}`, { method: "PATCH", body: input, module: "reviews" })),
      remove: async (id) => {
        await call(`/store/customers/me/reviews/${id}`, { method: "DELETE", module: "reviews" });
      },
    },
  };
}
