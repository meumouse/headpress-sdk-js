import { describe, expect, it } from "vitest";

import {
  addMoney,
  formatMoney,
  money,
  moneyFromDecimal,
  moneyFromMinor,
  multiplyMoney,
  sumMoney,
  toMajor,
} from "../src/index.js";

const BRL = {
  code: "BRL",
  symbol: "R$",
  minor_unit: 2,
  decimal_separator: ",",
  thousand_separator: ".",
  prefix: "R$ ",
  suffix: "",
};

describe("money", () => {
  it("parses minor units from numbers and numeric strings, null otherwise", () => {
    expect(moneyFromMinor("129990", BRL)).toEqual({ amount: 129990, currency: "BRL", minorUnit: 2 });
    expect(moneyFromMinor(1999, "brl")?.currency).toBe("BRL");
    expect(moneyFromMinor("", BRL)).toBeNull();
    expect(moneyFromMinor("12,90", BRL)).toBeNull();
    expect(moneyFromMinor(undefined, BRL)).toBeNull();
  });

  it("parses decimals without floating-point drift", () => {
    expect(moneyFromDecimal("199.90", BRL)?.amount).toBe(19990);
    expect(moneyFromDecimal("0.1", BRL)?.amount).toBe(10);
    expect(moneyFromDecimal("1.005", BRL)?.amount).toBe(101);
    expect(moneyFromDecimal("-2.5", BRL)?.amount).toBe(-250);
    expect(moneyFromDecimal(19.99, BRL)?.amount).toBe(1999);
    expect(moneyFromDecimal("1500", { code: "JPY", minor_unit: 0 })?.amount).toBe(1500);
    expect(moneyFromDecimal("abc", BRL)).toBeNull();
  });

  it("adds in integers and refuses to mix currencies", () => {
    const a = money(1999, BRL);
    expect(sumMoney([a, a, a]).amount).toBe(5997);
    expect(multiplyMoney(a, 3).amount).toBe(5997);
    expect(toMajor(a)).toBe(19.99);
    expect(sumMoney([], BRL).amount).toBe(0);
    expect(() => addMoney(a, money(100, "USD"))).toThrow(TypeError);
    expect(() => multiplyMoney(a, 1.5)).toThrow(RangeError);
  });

  it("formats like WooCommerce with the store format", () => {
    expect(formatMoney(money(129990, BRL), { format: BRL })).toBe("R$ 1.299,90");
    expect(formatMoney(money(5, BRL), { format: BRL })).toBe("R$ 0,05");
    expect(formatMoney(money(-1000, BRL), { format: BRL })).toBe("-R$ 10,00");
    expect(formatMoney(money(123456789, BRL), { format: BRL })).toBe("R$ 1.234.567,89");
    expect(formatMoney(money(1500, { code: "JPY", minor_unit: 0 }), { format: { code: "JPY", symbol: "¥" } })).toBe(
      "¥1,500",
    );
  });

  it("formats with Intl for a locale, deterministic by default", () => {
    expect(formatMoney(money(129990, BRL), { locale: "pt-BR" }).replace(/\s/g, " ")).toBe("R$ 1.299,90");
    expect(formatMoney(money(129990, "USD"))).toBe("$1,299.90");
  });
});
