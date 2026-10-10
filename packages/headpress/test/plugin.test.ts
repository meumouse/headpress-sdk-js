import { describe, expect, expectTypeOf, it } from "vitest";

import { createHeadpress, definePlugin, HeadpressError } from "../src/index.js";
import { ptBR } from "../src/messages/pt-BR.js";
import { BASE, json, mockFetch, storeConfig, wpError, rejection } from "./helpers.js";

declare module "../src/index.js" {
  interface ModuleConfigMap {
    cm_store: { enabled: true; welcome_coupon: { enabled: boolean; percent: number } };
  }
}

const cm = definePlugin({
  name: "cm",
  setup: ({ request }) => ({
    welcomeCoupon: (email: string, captcha: string) =>
      request<{ coupon: string }>("/store/cm/discounts/welcome", {
        body: { email },
        captcha,
        module: "cm_marketing",
      }),
  }),
  onRequest: ({ init }) => {
    init.headers.set("X-Store", "cm");
  },
  onError: (error) =>
    error.code === "cm_invalid_cpf" ? new HeadpressError("headpress_validation_failed", error.message, 422, { fields: { cpf: "CPF inválido." } }) : undefined,
  messages: { "pt-BR": { headpress_email_exists: "Esse e-mail já é cliente da Camila." } },
});

const logger = definePlugin({ name: "logger", onResponse: () => undefined });

describe("plugins", () => {
  it("adds typed resources under the plugin name and runs its hooks", async () => {
    const { fetch, calls } = mockFetch(() => json({ coupon: "BEMVINDA-1" }));
    const hp = createHeadpress({ baseUrl: BASE, fetch, plugins: [cm, logger] });

    expectTypeOf(hp.cm.welcomeCoupon).returns.resolves.toEqualTypeOf<{ coupon: string }>();
    // Plugins without setup add no key.
    expect("logger" in hp).toBe(false);

    await expect(hp.cm.welcomeCoupon("a@b.c", "tok")).resolves.toEqual({ coupon: "BEMVINDA-1" });
    expect(calls[0]?.headers.get("X-Store")).toBe("cm");
    expect(calls[0]?.headers.get("X-Headpress-Captcha")).toBe("tok");
  });

  it("lets a plugin translate errors and word them", async () => {
    const { fetch } = mockFetch(() => wpError(400, "cm_invalid_cpf", "Invalid CPF"));
    const hp = createHeadpress({ baseUrl: BASE, fetch, plugins: [cm], messages: ptBR, config: { initial: storeConfig() } });
    const error = await rejection(hp.request("/store/customers/me/extras", { method: "PATCH", body: {} }));
    expect(error.code).toBe("headpress_validation_failed");
    expect(hp.formatError(error)).toBe("CPF inválido.");
    expect(hp.formatError(new HeadpressError("headpress_email_exists", "x", 409))).toBe(
      "Esse e-mail já é cliente da Camila.",
    );
  });

  it("types add-on module configs through declaration merging", () => {
    const hp = createHeadpress({ baseUrl: BASE });
    expectTypeOf(hp.capabilities.get("cm_store")).toEqualTypeOf<
      { enabled: true; welcome_coupon: { enabled: boolean; percent: number } } | undefined
    >();
  });

  it("refuses plugin names that clash with the client", () => {
    expect(() => createHeadpress({ baseUrl: BASE, plugins: [definePlugin({ name: "config" })] })).toThrow(TypeError);
    expect(() => createHeadpress({ baseUrl: BASE, plugins: [logger, logger] })).toThrow(TypeError);
  });
});
