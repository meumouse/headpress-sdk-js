/**
 * Account payloads from Headpress (`accounts`, `passwordless`, `google_sign_in`, `wishlist`,
 * `address_book`, `saved_payment_methods`).
 *
 * They keep Headpress's own keys: they are the contract, modules add fields to them, and several
 * are posted back as they are (profile, addresses). Money is the exception — amounts are `Money`.
 */
import type { Money } from "./money.js";

export interface AccountAddress {
  first_name: string;
  last_name: string;
  company: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  phone: string;
  /** Billing only. */
  email?: string;
  [key: string]: unknown;
}

export interface Customer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  avatar_url: string;
  is_paying_customer?: boolean;
  date_created?: string | null;
  billing: Partial<AccountAddress>;
  shipping: Partial<AccountAddress>;
  /** `passwordless`: the verified login phone. */
  phone?: { number: string | null; verified: boolean; verified_at: string | null } | null;
  email_verified?: boolean;
  email_verified_at?: string | null;
  /** `google_sign_in`: the linked Google account. */
  google?: GoogleAccount | null;
  /** Fields add-on modules add. */
  [key: string]: unknown;
}

export interface GoogleAccount {
  linked: boolean;
  email: string | null;
  linked_at: string | null;
}

export interface OtpChallenge {
  challenge_id: string;
  channel: string;
  masked_recipient: string;
  /** Seconds until the code expires. */
  expires_in: number;
  /** Seconds until a resend is allowed; null when no resend is left. */
  resend_in: number | null;
}

export interface PhoneState {
  phone: string;
  verified_at: string | null;
  moved_from_other_account: boolean;
}

/** What a sign-in resolves with. Tokens are stored by the client, never returned. */
export interface SignInResult {
  customer: Customer | null;
  /** The customer's Cart-Token (the guest cart merged into it), already stored by the client. */
  cartToken: string | null;
  /** `otp`: why the code was asked for. */
  purpose?: "login" | "recovery";
  /** `otp`: for this many seconds the password can change without the current one. */
  grant?: { expires_in: number };
}

export type OtpVerifyResult =
  | ({ status: "signed_in" } & SignInResult)
  | { status: "needs_registration"; registrationToken: string; expiresIn: number };

export interface OrderSummary {
  id: number;
  number: string;
  status: string;
  status_label: string;
  date_created: string | null;
  currency: string;
  total: Money;
  item_count: number;
  needs_payment: boolean;
  order_key: string;
  [key: string]: unknown;
}

export interface OrderItem {
  id: number;
  product_id: number;
  variation_id: number;
  name: string;
  sku: string;
  quantity: number;
  subtotal: Money;
  total: Money;
  image: string | null;
  /** Storefront URL of the product. */
  url: string | null;
  meta: { key: string; value: string }[];
  [key: string]: unknown;
}

export interface OrderDetail extends OrderSummary {
  payment_method: string;
  payment_method_title: string;
  customer_note: string;
  totals: { subtotal: Money; discount: Money; shipping: Money; tax: Money; fees: Money; total: Money; refunded: Money };
  shipping_lines: { method_id: string; title: string; total: Money }[];
  billing: AccountAddress;
  shipping: AccountAddress;
  items: OrderItem[];
  notes: { date: string | null; content: string }[];
}

export interface WishlistProduct {
  id: number;
  name: string;
  slug: string;
  type: string;
  /** Storefront URL. */
  url: string | null;
  image: string | null;
  price: Money | null;
  regular_price: Money | null;
  sale_price: Money | null;
  [key: string]: unknown;
}

export interface Wishlist {
  count: number;
  ids: number[];
  products: WishlistProduct[];
}

export interface SavedAddress extends AccountAddress {
  id: string;
  label: string;
  number: string;
  neighborhood: string;
  /** CPF (11 digits) or CNPJ (14 digits), or empty. */
  document: string;
  is_default_shipping: boolean;
  is_default_billing: boolean;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export type SavedAddressInput = Partial<Omit<SavedAddress, "id" | "created_at" | "updated_at" | "last_used_at">>;

export interface SavedPaymentMethod {
  id: string;
  gateway_id: string;
  gateway_title: string;
  type: string;
  brand: string;
  last4: string;
  holder_name: string;
  exp_month: number | null;
  exp_year: number | null;
  expired: boolean;
  is_default: boolean;
  requires_cvc: boolean;
  /** Data the gateway's browser SDK needs (a card id…). */
  client: Record<string, unknown>;
  created_at: string;
  [key: string]: unknown;
}
