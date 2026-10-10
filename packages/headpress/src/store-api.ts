/**
 * Raw shapes of the WooCommerce Store API (`wc/store/v1`), as far as the SDK reads them.
 *
 * Amounts are strings of minor units ("19990"). Names and descriptions may carry HTML entities.
 * The normalizers in `catalog.ts` and `cart.ts` turn these into the SDK's types; the raw object
 * stays available as `raw` for anything they leave out.
 */

export interface StoreCurrency {
  currency_code: string;
  currency_symbol: string;
  currency_minor_unit: number;
  currency_decimal_separator: string;
  currency_thousand_separator: string;
  currency_prefix: string;
  currency_suffix: string;
}

export interface StorePrices extends StoreCurrency {
  price: string;
  regular_price: string;
  sale_price: string;
  price_range: { min_amount: string; max_amount: string } | null;
}

export interface StoreImage {
  id: number;
  src: string;
  thumbnail: string;
  srcset: string;
  sizes: string;
  name: string;
  alt: string;
}

export interface StoreTermRef {
  id: number;
  name: string;
  slug: string;
  link: string;
}

export interface StoreProductAttribute {
  id: number;
  name: string;
  taxonomy: string | null;
  has_variations: boolean;
  terms: { id: number; name: string; slug: string; default?: boolean }[];
}

export interface StoreProduct {
  id: number;
  name: string;
  slug: string;
  parent: number;
  type: string;
  variation: string;
  permalink: string;
  sku: string;
  short_description: string;
  description: string;
  on_sale: boolean;
  prices: StorePrices;
  price_html: string;
  average_rating: string;
  review_count: number;
  images: StoreImage[];
  categories: StoreTermRef[];
  tags: StoreTermRef[];
  brands?: StoreTermRef[];
  attributes: StoreProductAttribute[];
  variations: { id: number; attributes: { name: string; value: string | null }[] }[];
  grouped_products?: number[];
  has_options: boolean;
  is_purchasable: boolean;
  is_in_stock: boolean;
  is_on_backorder: boolean;
  low_stock_remaining: number | null;
  stock_availability?: { text: string; class: string };
  sold_individually: boolean;
  add_to_cart: { text: string; description: string; url: string; minimum?: number; maximum?: number; multiple_of?: number };
  is_password_protected?: boolean;
  extensions: Record<string, unknown>;
}

export interface StoreCategory {
  id: number;
  name: string;
  slug: string;
  description: string;
  parent: number;
  count: number;
  image: StoreImage | null;
  review_count: number;
  permalink: string;
}

export interface StoreAddress {
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
  email?: string;
}

export interface StoreCartItem {
  key: string;
  id: number;
  type?: string;
  quantity: number;
  quantity_limits: { minimum: number; maximum: number; multiple_of: number; editable: boolean };
  name: string;
  short_description: string;
  description: string;
  sku: string;
  low_stock_remaining: number | null;
  backorders_allowed: boolean;
  show_backorder_badge: boolean;
  sold_individually: boolean;
  permalink: string;
  images: StoreImage[];
  variation: { attribute: string; value: string }[];
  item_data: { name?: string; key?: string; value: string; display?: string; hidden?: boolean }[];
  prices: StorePrices & { raw_prices?: Record<string, string> };
  totals: StoreCurrency & {
    line_subtotal: string;
    line_subtotal_tax: string;
    line_total: string;
    line_total_tax: string;
  };
  catalog_visibility?: string;
  extensions: Record<string, unknown>;
}

export interface StoreShippingRate extends StoreCurrency {
  rate_id: string;
  name: string;
  description: string;
  delivery_time: string;
  price: string;
  taxes: string;
  instance_id: number;
  method_id: string;
  meta_data: { key: string; value: unknown }[];
  selected: boolean;
}

export interface StoreShippingPackage {
  package_id: number | string;
  name: string;
  destination: Partial<StoreAddress>;
  items: { key: string; name: string; quantity: number }[];
  shipping_rates: StoreShippingRate[];
}

export interface StoreCart {
  items: StoreCartItem[];
  coupons: { code: string; discount_type: string; totals: StoreCurrency & { total_discount: string; total_discount_tax: string } }[];
  fees: { id: string; name: string; totals: StoreCurrency & { total: string; total_tax: string } }[];
  totals: StoreCurrency & {
    total_items: string;
    total_items_tax: string;
    total_fees: string;
    total_fees_tax: string;
    total_discount: string;
    total_discount_tax: string;
    total_shipping: string | null;
    total_shipping_tax: string | null;
    total_price: string;
    total_tax: string;
    tax_lines: { name: string; price: string; rate: string }[];
  };
  shipping_address: StoreAddress;
  billing_address: StoreAddress;
  needs_payment: boolean;
  needs_shipping: boolean;
  payment_requirements: string[];
  has_calculated_shipping: boolean;
  shipping_rates: StoreShippingPackage[];
  items_count: number;
  items_weight: number;
  cross_sells: StoreProduct[];
  errors: { code: string; message: string }[];
  payment_methods: string[];
  extensions: Record<string, unknown>;
}
