/**
 * What browsers get for `@meumouse/headpress/server`: the same names, all refusing to run, so a
 * server import that leaks into a client bundle fails loudly instead of shipping the secret key.
 */
import { HeadpressError, SdkErrorCode } from "../errors.js";

function refuse(): never {
  throw new HeadpressError(
    SdkErrorCode.serverOnly,
    "@meumouse/headpress/server was bundled for the browser. Import it from server code only.",
    0,
  );
}

export const createServerHeadpress: (...args: unknown[]) => never = refuse;
export const clientIp: (...args: unknown[]) => never = refuse;
export const parseIp: (...args: unknown[]) => never = refuse;
export const CLOUDFLARE_RANGES: readonly string[] = [];
export const PRIVATE_RANGES: readonly string[] = [];
export const memoryCache: (...args: unknown[]) => never = refuse;
export const redisCache: (...args: unknown[]) => never = refuse;
export const swr: (...args: unknown[]) => never = refuse;
