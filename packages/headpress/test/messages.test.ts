import { describe, expect, it } from "vitest";

import { formatError, HeadpressError, SdkErrorCode } from "../src/index.js";
import { en } from "../src/messages/en.js";
import { es } from "../src/messages/es.js";
import { ptBR } from "../src/messages/pt-BR.js";

describe("formatError", () => {
  it("prefers the code in context, then the code", () => {
    const error = new HeadpressError("headpress_unauthorized", "Unauthorized", 401);
    expect(formatError(error, { messages: ptBR, context: "login" })).toBe("E-mail ou senha incorretos.");
    expect(formatError(error, { messages: ptBR })).toBe("Sua sessão expirou. Entre novamente.");
  });

  it("uses error data in function entries", () => {
    const otp = new HeadpressError("headpress_otp_invalid", "x", 400, { attempts_left: 1 });
    expect(formatError(otp, { messages: ptBR })).toBe("Código incorreto. Você ainda tem 1 tentativa.");
    expect(formatError(otp, { messages: en })).toBe("Wrong code. You have 1 attempt left.");
    expect(formatError(otp, { messages: es })).toBe("Código incorrecto. Te queda 1 intento.");

    const validation = new HeadpressError("headpress_validation_failed", "x", 422, {
      fields: { title: "O título é obrigatório." },
    });
    expect(formatError(validation, { messages: ptBR })).toBe("O título é obrigatório.");
  });

  it("lets later dictionaries override earlier ones", () => {
    const error = new HeadpressError("headpress_email_exists", "x", 409);
    expect(formatError(error, { messages: [ptBR, { headpress_email_exists: "Você já tem conta." }] })).toBe(
      "Você já tem conta.",
    );
  });

  it("falls back to network/upstream texts, then the server message, then $unknown", () => {
    const network = new HeadpressError(SdkErrorCode.network, "Could not reach", 0);
    expect(formatError(network, { messages: ptBR })).toMatch(/^Não foi possível conectar/);

    const upstream = new HeadpressError("some_gateway_failure", "Gateway exploded", 502);
    expect(formatError(upstream, { messages: ptBR })).toBe("O servidor não respondeu. Tente novamente em instantes.");

    const unknown = new HeadpressError("cm_custom_rule", "Mensagem do servidor.", 400);
    expect(formatError(unknown, { messages: ptBR })).toBe("Mensagem do servidor.");
    expect(formatError(unknown, { messages: ptBR, fallback: "Outra." })).toBe("Outra.");

    // A plain bug never leaks its message to shoppers.
    expect(formatError(new TypeError("x is undefined"), { messages: ptBR })).toBe("Algo deu errado. Tente novamente.");
  });

  it("keeps every dictionary on the same keys", () => {
    const keys = Object.keys(ptBR).sort();
    expect(Object.keys(en).sort()).toEqual(keys);
    expect(Object.keys(es).sort()).toEqual(keys);
  });
});
