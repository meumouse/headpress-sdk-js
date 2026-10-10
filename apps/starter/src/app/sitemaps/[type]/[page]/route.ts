import { renderSitemap } from "@meumouse/headpress";
import { xmlResponse } from "@meumouse/headpress/next";

import { hp } from "@/lib/headpress";

export const revalidate = 3600;

/** One page of one sitemap. Entries already point at the storefront (`config.routes`). */
export async function GET(_request: Request, { params }: { params: Promise<{ type: string; page: string }> }) {
  const { type, page } = await params;
  const number = Number.parseInt(page, 10) || 1;
  try {
    const sitemap = await hp.seo.sitemap(type, number);
    if (!sitemap || number > Math.max(1, sitemap.pages)) return new Response("Not found", { status: 404 });
    return xmlResponse(renderSitemap(sitemap.entries));
  } catch (error) {
    console.error(`[starter] sitemap ${type}/${number}:`, error);
    return new Response("Sitemap unavailable", { status: 503 });
  }
}
