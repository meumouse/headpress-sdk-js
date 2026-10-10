import { renderSitemapIndex, sitemapIndexEntries } from "@meumouse/headpress";
import { xmlResponse } from "@meumouse/headpress/next";

import { hp, siteUrl } from "@/lib/headpress";

export const revalidate = 3600;

/**
 * The sitemap index, one entry per type and page Headpress publishes. Sub-sitemaps are served at
 * `/<type>-sitemap<page>.xml` (Rank Math's naming), rewritten by the proxy to `/sitemaps/<type>/<page>`.
 */
export async function GET() {
  try {
    const [index, origin] = await Promise.all([hp.seo.sitemapIndex(), siteUrl()]);
    const entries = sitemapIndexEntries(index, (type, page) => `${origin}/${type}-sitemap${page > 1 ? page : ""}.xml`);
    return xmlResponse(renderSitemapIndex(entries));
  } catch (error) {
    console.error("[starter] sitemap index:", error);
    return new Response("Sitemap unavailable", { status: 503 });
  }
}
