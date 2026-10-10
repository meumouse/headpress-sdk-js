/**
 * Hand-off between entry points, kept out of the public API: `@meumouse/headpress/server`
 * installs the secret-key credentials through this symbol.
 */
import type { ServerAuth } from "./transport.js";

export const SERVER_AUTH: unique symbol = Symbol.for("@meumouse/headpress/server-auth");

export interface InternalOptions {
  [SERVER_AUTH]?: ServerAuth;
}
