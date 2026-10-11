/**
 * Next.js 16 proxy (formerly middleware): sitemap file names and the SEO plugin's redirects.
 *
 * - `/<type>-sitemap<n>.xml` → `/sitemaps/<type>/<n>` (route handler), Rank Math's file names.
 * - Redirect rules come from Headpress (`hp.seo.redirects()`), cached in-process for a minute and
 *   matched with Rank Math's semantics. Without rules — or with Headpress down — nothing redirects.
 */
import { NextResponse, type NextRequest } from "next/server";

import { createHeadpress, createRedirectResolver } from "@meumouse.com/headpress";
import { redirectResponse } from "@meumouse.com/headpress/next";

const wpUrl = process.env.NEXT_PUBLIC_WP_URL ?? "";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

// A bare client: the proxy only reads public redirect rules.
const hp = wpUrl ? createHeadpress({ baseUrl: wpUrl, publishableKey: process.env.NEXT_PUBLIC_HEADPRESS_PUBLISHABLE_KEY || undefined }) : null;
const redirects = hp ? createRedirectResolver(hp.seo, { sameHosts: [wpUrl, siteUrl].filter(Boolean) }) : null;

const SITEMAP_FILE = /^\/([a-z0-9_-]+?)-sitemap(\d*)\.xml$/i;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const sitemap = SITEMAP_FILE.exec(pathname);
  if (sitemap) {
    const url = request.nextUrl.clone();
    url.pathname = `/sitemaps/${sitemap[1]}/${sitemap[2] || "1"}`;
    return NextResponse.rewrite(url);
  }

  if (redirects && (request.method === "GET" || request.method === "HEAD")) {
    const match = await redirects.resolve(request.nextUrl);
    if (match) return redirectResponse(match, request.url);
  }
  return NextResponse.next();
}

export const config = {
  // Pages and sitemap files; never the API, Next.js assets or static files.
  matcher: ["/((?!api/|_next/|favicon.ico|.*\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|txt|woff2?)$).*)"],
};
