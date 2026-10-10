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

export interface ServerHeadpressOptions<P extends readonly AnyPlugin[] = readonly []> extends HeadpressOptions<P> {
  /** Secret key (`hp_sk_…`). Without it, `secret` calls fail and shopper IPs are not forwarded. */
  secretKey?: string;
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
  const { secretKey, ...rest } = options;

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
      if (requestOptions.clientIp && secretKey) {
        headers.set("X-Headpress-Secret", secretKey);
        headers.set("X-Headpress-Client-IP", requestOptions.clientIp);
      }
    },
  });
}
