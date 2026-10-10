/**
 * `@meumouse/headpress/server`: the client for server code.
 *
 * Adds what must never reach a browser:
 *
 * - the secret key (`hp_sk_…`), sent as `Authorization: Bearer` on calls with `secret: true`
 *   (Headpress `server/*` routes);
 * - the shopper's IP, forwarded on calls with `clientIp` as `X-Headpress-Client-IP` together with
 *   `X-Headpress-Secret`. Headpress only trusts the forwarded IP with a valid secret; without it
 *   every shopper behind the storefront would share one rate-limit bucket.
 *
 * Bundlers resolve this entry to a stub that throws when it is imported for the browser.
 */
import { createHeadpress, type Headpress, type HeadpressOptions } from "../client.js";
import { HeadpressError, SdkErrorCode } from "../errors.js";
import { SERVER_AUTH } from "../internal.js";
import type { AnyPlugin } from "../plugin.js";
import { isBrowser } from "../transport.js";

export { clientIp, parseIp, CLOUDFLARE_RANGES, PRIVATE_RANGES, type ClientIpOptions } from "./client-ip.js";
export {
  memoryCache,
  redisCache,
  swr,
  type CacheOutcome,
  type CacheStore,
  type MemoryCacheOptions,
  type RedisCacheOptions,
  type RedisLikeClient,
  type SwrOptions,
} from "./cache.js";

export interface ServerHeadpressOptions<P extends readonly AnyPlugin[] = readonly []> extends HeadpressOptions<P> {
  /** Secret key (`hp_sk_…`). Without it, `secret` calls fail and shopper IPs are not forwarded. */
  secretKey?: string;
  /**
   * The shopper's IP for every call of this client (create one client per request), so resources
   * and plugins forward it too. A call's own `clientIp` wins.
   */
  clientIp?: string | null;
}

export function createServerHeadpress<const P extends readonly AnyPlugin[] = readonly []>(
  options: ServerHeadpressOptions<P>,
): Headpress<P> {
  if (isBrowser()) {
    throw new HeadpressError(
      SdkErrorCode.serverOnly,
      "@meumouse/headpress/server cannot run in the browser.",
      0,
    );
  }
  const { secretKey, clientIp: defaultClientIp, ...rest } = options;

  return createHeadpress<P>({
    ...rest,
    [SERVER_AUTH]: (headers, requestOptions) => {
      if (requestOptions.secret) {
        if (!secretKey) {
          throw new HeadpressError(
            SdkErrorCode.secretMissing,
            "This call needs the secret key: pass secretKey to createServerHeadpress().",
            0,
          );
        }
        headers.set("Authorization", `Bearer ${secretKey}`);
      }
      const ip = requestOptions.clientIp ?? defaultClientIp;
      if (ip && secretKey) {
        headers.set("X-Headpress-Secret", secretKey);
        headers.set("X-Headpress-Client-IP", ip);
      }
    },
  });
}
