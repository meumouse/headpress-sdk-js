/**
 * Shopper-facing text for errors.
 *
 * Headpress writes error messages in the site language and for developers, so the interface maps
 * codes to its own text. A dictionary maps keys to a string or to a function of the error:
 *
 * - `"<code>@<context>"` — the code in one situation (`headpress_unauthorized@login` is a wrong
 *   password, while elsewhere the same code is an expired session);
 * - `"<code>"`;
 * - `"$network"` — no response arrived (offline, timeout);
 * - `"$upstream"` — WordPress or something behind it failed (5xx);
 * - `"$unknown"` — anything else that has no message of its own.
 *
 * A Headpress error with a code no dictionary knows falls back to `fallback`, then to the server's
 * message (written in the site language), and only then to `$unknown`.
 *
 * Dictionaries are looked up in order, last one first, so a store's overrides win over the
 * built-in ones (`@meumouse.com/headpress/messages/pt-BR`, `/en`, `/es`).
 */
import { HeadpressError, isHeadpressError, SdkErrorCode } from "./errors.js";

export type MessageEntry =
  | string
  | ((error: HeadpressError, context: string | undefined) => string | undefined);

export type Messages = Readonly<Record<string, MessageEntry>>;

export interface FormatErrorOptions {
  /** Dictionaries, lowest priority first. */
  messages?: Messages | readonly Messages[];
  /** The situation the error happened in (`login`, `checkout`…), for `<code>@<context>` keys. */
  context?: string;
  /** Text when no dictionary has an entry. Defaults to the error's own message. */
  fallback?: string;
}

const NO_RESPONSE = new Set<string>([SdkErrorCode.network, SdkErrorCode.timeout]);

function keysFor(error: unknown, context: string | undefined): string[] {
  if (!isHeadpressError(error)) return [];
  const keys: string[] = [];
  if (context) keys.push(`${error.code}@${context}`);
  keys.push(error.code);
  if (NO_RESPONSE.has(error.code)) keys.push("$network");
  if (error.status >= 500) keys.push("$upstream");
  return keys;
}

function lookup(
  dictionaries: readonly Messages[],
  keys: readonly string[],
  error: unknown,
  context: string | undefined,
): string | undefined {
  for (const key of keys) {
    for (let i = dictionaries.length - 1; i >= 0; i--) {
      const entry = dictionaries[i]?.[key];
      if (entry === undefined) continue;
      if (typeof entry === "string") return entry;
      const headpressError = isHeadpressError(error)
        ? error
        : new HeadpressError("headpress_unknown_error", String((error as Error)?.message ?? ""), 0);
      const text = entry(headpressError, context);
      if (text) return text;
    }
  }
  return undefined;
}

/** Text for an error, from the given dictionaries. */
export function formatError(error: unknown, options: FormatErrorOptions = {}): string {
  const dictionaries = (
    Array.isArray(options.messages) ? options.messages : options.messages ? [options.messages] : []
  ) as readonly Messages[];

  const text = lookup(dictionaries, keysFor(error, options.context), error, options.context);
  if (text) return text;
  if (options.fallback) return options.fallback;
  if (isHeadpressError(error) && error.message) return error.message;
  return lookup(dictionaries, ["$unknown"], error, options.context) ?? "Something went wrong.";
}

/** First message of a `headpress_validation_failed` error's `data.fields`, if any. */
export function firstFieldMessage(error: HeadpressError): string | undefined {
  const fields = error.data.fields;
  if (!fields || typeof fields !== "object") return undefined;
  return Object.values(fields as Record<string, unknown>).find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}
