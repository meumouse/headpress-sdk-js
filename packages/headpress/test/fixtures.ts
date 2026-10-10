import type { StoreCart, StoreCartItem, StoreCurrency, StoreProduct } from "../src/index.js";

export const BRL: StoreCurrency = {
  currency_code: "BRL",
  currency_symbol: "R$",
  currency_minor_unit: 2,
  currency_decimal_separator: ",",
  currency_thousand_separator: ".",
  currency_prefix: "R$ ",
  currency_suffix: "",
};

export function storeProduct(overrides: Partial<StoreProduct> = {}): StoreProduct {
  return {
    id: 12,
    name: "Anel &#8220;Solit&aacute;rio&#8221; &#038; Cia",
    slug: "anel-solitario",
    parent: 0,
    type: "simple",
    variation: "",
    permalink: "https://wp.test/produto/anel-solitario/",
    sku: "AN-1",
    short_description: "<p>Curto</p>",
    description: "<p>Longo</p>",
    on_sale: true,
    prices: { ...BRL, price: "19990", regular_price: "24990", sale_price: "19990", price_range: null },
    price_html: "",
    average_rating: "4.50",
    review_count: 8,
    images: [{ id: 1, src: "https://wp.test/a.jpg", thumbnail: "https://wp.test/a-150.jpg", srcset: "", sizes: "", name: "a", alt: "Anel &amp; caixa" }],
    categories: [{ id: 7, name: "An&eacute;is", slug: "aneis", link: "https://wp.test/aneis" }],
    tags: [],
    brands: [],
    attributes: [],
    variations: [],
    has_options: false,
    is_purchasable: true,
    is_in_stock: true,
    is_on_backorder: false,
    low_stock_remaining: 2,
    stock_availability: { text: "Apenas 2 em estoque", class: "in-stock" },
    sold_individually: false,
    add_to_cart: { text: "Comprar", description: "", url: "", minimum: 1, maximum: 9999, multiple_of: 1 },
    extensions: {},
    ...overrides,
  };
}

export function storeCartItem(overrides: Partial<StoreCartItem> = {}): StoreCartItem {
  return {
    key: "abc123",
    id: 12,
    type: "simple",
    quantity: 2,
    quantity_limits: { minimum: 1, maximum: 5, multiple_of: 1, editable: true },
    name: "Anel &amp; Cia",
    short_description: "",
    description: "",
    sku: "AN-1",
    low_stock_remaining: null,
    backorders_allowed: false,
    show_backorder_badge: false,
    sold_individually: false,
    permalink: "https://wp.test/produto/anel/",
    images: [],
    variation: [{ attribute: "Tamanho", value: "16" }],
    item_data: [{ name: "Grava&ccedil;&atilde;o", value: "Ana", display: "Ana" }, { key: "_hidden", value: "x", hidden: true }],
    prices: { ...BRL, price: "19990", regular_price: "24990", sale_price: "19990", price_range: null },
    totals: { ...BRL, line_subtotal: "39980", line_subtotal_tax: "0", line_total: "35982", line_total_tax: "0" },
    extensions: {},
    ...overrides,
  };
}

export function storeCart(overrides: Partial<StoreCart> = {}): StoreCart {
  return {
    items: [storeCartItem()],
    coupons: [{ code: "bemvinda", discount_type: "percent", totals: { ...BRL, total_discount: "3998", total_discount_tax: "0" } }],
    fees: [{ id: "pix", name: "Desconto Pix", totals: { ...BRL, total: "-1799", total_tax: "0" } }],
    totals: {
      ...BRL,
      total_items: "39980",
      total_items_tax: "0",
      total_fees: "-1799",
      total_fees_tax: "0",
      total_discount: "3998",
      total_discount_tax: "0",
      total_shipping: null,
      total_shipping_tax: null,
      total_price: "34183",
      total_tax: "0",
      tax_lines: [],
    },
    shipping_address: { first_name: "", last_name: "", company: "", address_1: "", address_2: "", city: "", state: "", postcode: "", country: "BR", phone: "" },
    billing_address: { first_name: "", last_name: "", company: "", address_1: "", address_2: "", city: "", state: "", postcode: "", country: "BR", phone: "", email: "" },
    needs_payment: true,
    needs_shipping: true,
    payment_requirements: ["products"],
    has_calculated_shipping: false,
    shipping_rates: [
      {
        package_id: 0,
        name: "Envio 1",
        destination: { postcode: "01310-100" },
        items: [{ key: "abc123", name: "Anel", quantity: 2 }],
        shipping_rates: [
          { ...BRL, rate_id: "flat_rate:1", name: "PAC", description: "", delivery_time: "", price: "2201", taxes: "0", instance_id: 1, method_id: "flat_rate", meta_data: [{ key: "delivery_days", value: 5 }], selected: true },
        ],
      },
    ],
    items_count: 2,
    items_weight: 0,
    cross_sells: [],
    errors: [],
    payment_methods: ["pix"],
    extensions: {
      headpress: { shipping: { free_shipping: { enabled: true, threshold: 59900, subtotal: 39980, remaining: 19920, qualifies: false, has_free_rate: false } } },
    },
    ...overrides,
  };
}
