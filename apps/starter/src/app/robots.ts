import type { MetadataRoute } from "next";

import { hp, siteUrl } from "@/lib/headpress";

export const revalidate = 3600;

/** Keeps shopper-only routes (from the route map) out of search engines and points at the sitemap. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  try {
    await hp.config.get();
    const origin = await siteUrl();
    // Path part only: `order_received` may carry its tokens in the query string.
    const privatePaths = (["cart", "checkout", "account"] as const)
      .map((key) => hp.routes.pattern(key)?.split("?")[0])
      .filter((path): path is string => Boolean(path));
    return {
      rules: [{ userAgent: "*", allow: "/", disallow: [...privatePaths, "/api/"] }],
      sitemap: `${origin}/sitemap_index.xml`,
    };
  } catch {
    return { rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }] };
  }
}
