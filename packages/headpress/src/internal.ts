/**
 * Hand-off between entry points, kept out of the public API: `@meumouse.com/headpress/server`
 * installs the secret-key credentials through this symbol.
 */
import type { ServerAuth } from "./transport.js";

export const SERVER_AUTH: unique symbol = Symbol.for("@meumouse.com/headpress/server-auth");

export interface InternalOptions {
  [SERVER_AUTH]?: ServerAuth;
}
