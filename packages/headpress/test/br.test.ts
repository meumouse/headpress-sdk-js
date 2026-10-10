import { describe, expect, it } from "vitest";

import {
  brazilianMarketValues,
  canonicalPhone,
  documentType,
  formatBirthDate,
  isMobilePhone,
  isValidCep,
  isValidCnpj,
  isValidCpf,
  lookupCep,
  maskCep,
  maskCnpj,
  maskCpf,
  maskDocument,
  maskPhone,
  parseBirthDate,
} from "../src/br/index.js";

describe("documents", () => {
  it("validates CPF and CNPJ check digits", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
    expect(documentType("52998224725")).toBe("cpf");
    expect(documentType("11222333000181")).toBe("cnpj");
    expect(documentType("123")).toBeNull();
  });

  it("masks as the user types", () => {
    expect(maskCpf("5299822")).toBe("529.982.2");
    expect(maskCpf("52998224725")).toBe("529.982.247-25");
    expect(maskCnpj("11222333000181")).toBe("11.222.333/0001-81");
    expect(maskDocument("529982247251")).toBe("52.998.224/7251");
    expect(maskCep("01310100")).toBe("01310-100");
    expect(isValidCep("00000-000")).toBe(false);
  });
});

describe("phones and dates", () => {
  it("canonicalizes Brazilian phones", () => {
    expect(canonicalPhone("(51) 99999-8888")).toBe("5551999998888");
    expect(canonicalPhone("+55 51 3333-4444")).toBe("555133334444");
    expect(canonicalPhone("51 89999-8888")).toBeNull();
    expect(isMobilePhone("51999998888")).toBe(true);
    expect(isMobilePhone("5133334444")).toBe(false);
    expect(maskPhone("5551999998888")).toBe("(51) 99999-8888");
    expect(maskPhone("5133334444")).toBe("(51) 3333-4444");
  });

  it("parses birth dates", () => {
    const now = new Date(2026, 9, 10);
    expect(parseBirthDate("31/12/1990", now)).toBe("1990-12-31");
    expect(parseBirthDate("31/02/1990", now)).toBe("");
    expect(parseBirthDate("01/01/2030", now)).toBe("");
    expect(parseBirthDate("01/01/1899", now)).toBe("");
    expect(formatBirthDate("1990-12-31")).toBe("31/12/1990");
  });
});

describe("brazilianMarketValues", () => {
  it("builds person fields for CPF and CNPJ buyers, leaving empty ones out", () => {
    expect(brazilianMarketValues({ document: "529.982.247-25", number: "100", neighborhood: "Centro", cellphone: "(51) 99999-8888" })).toEqual({
      billing_persontype: "1",
      billing_cpf: "52998224725",
      billing_number: "100",
      billing_neighborhood: "Centro",
      shipping_number: "100",
      shipping_neighborhood: "Centro",
      billing_cellphone: "51999998888",
    });
    expect(brazilianMarketValues({ document: "11.222.333/0001-81", company: "ACME", shippingNumber: "5" })).toEqual({
      billing_persontype: "2",
      billing_cnpj: "11222333000181",
      billing_company: "ACME",
      shipping_number: "5",
    });
  });
});

describe("lookupCep", () => {
  it("maps ViaCEP answers, unknown CEPs and caches", async () => {
    let calls = 0;
    const fetch = (async (url: RequestInfo | URL) => {
      calls++;
      return String(url).includes("99999999")
        ? new Response(JSON.stringify({ erro: true }), { status: 200 })
        : new Response(JSON.stringify({ cep: "01310-100", logradouro: "Avenida Paulista", bairro: "Bela Vista", localidade: "São Paulo", uf: "SP", ibge: "3550308" }));
    }) as typeof globalThis.fetch;
    expect(await lookupCep("01310100", { fetch })).toEqual({
      postcode: "01310-100",
      address_1: "Avenida Paulista",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      ibge: "3550308",
    });
    await lookupCep("01310-100", { fetch });
    expect(calls).toBe(1);
    expect(await lookupCep("99999-999", { fetch })).toBeNull();
    expect(await lookupCep("123", { fetch })).toBeNull();
  });
});
