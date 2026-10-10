/**
 * Content (Headpress `content` module): posts, pages and terms resolved by storefront path,
 * navigation menus with links already pointing at the storefront, and draft previews.
 */
import { isHeadpressError } from "./errors.js";
import { normalizeSeoPath } from "./seo.js";
import type { Transport } from "./transport.js";

export type ContentTarget =
  | { path: string }
  | { type: "post"; id: number; postType?: string }
  | { type: "term"; taxonomy: string; id: number };

export interface ContentPost {
  id: number;
  type: string;
  status: string;
  slug: string;
  path: string | null;
  title: string;
  /** HTML. Empty for password-protected posts. */
  excerpt: string;
  /** Rendered HTML, links to posts mapped to the storefront. Empty for password-protected posts. */
  content: string;
  protected: boolean;
  date: string;
  modified: string;
  parent_id: number;
  template: string;
  author: { id: number; name: string; [key: string]: unknown } | null;
  featured_image: { id: number; src: string; alt: string; width?: number; height?: number; [key: string]: unknown } | null;
  terms: Record<string, { id: number; name: string; slug: string; path?: string | null }[]>;
  preview: boolean;
  [key: string]: unknown;
}

export interface ContentResult {
  /** What the path resolved to (`post`, `term`, `blog`, `home`, `shop`…). */
  kind: string;
  /** The post, when the path resolved to one. */
  post: ContentPost | null;
  /** Other payloads (a term) are passed through. */
  [key: string]: unknown;
  /** Tags Headpress revalidates when this content changes. */
  cache_tags: string[];
}

export interface MenuItem {
  id: number;
  title: string;
  url: string;
  path?: string | null;
  target?: string;
  classes?: string[];
  children?: MenuItem[];
  [key: string]: unknown;
}

export interface Menu {
  id: number;
  name: string;
  slug: string;
  location?: string | null;
  items: MenuItem[];
  [key: string]: unknown;
}

export interface Content {
  /** Content at a storefront path (or by id); null when nothing published is there. */
  get(target: ContentTarget, options?: { previewToken?: string; signal?: AbortSignal; revalidate?: number | false }): Promise<ContentResult | null>;
  /** Theme locations and every menu. */
  menus(options?: { signal?: AbortSignal }): Promise<{ locations: unknown[]; menus: unknown[] }>;
  /** A menu by theme location or slug; null when there is none. */
  menu(locationOrSlug: string, options?: { signal?: AbortSignal }): Promise<Menu | null>;
  /** Check a preview token from the editor's "Preview" link. */
  verifyPreview(token: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
}

export function createContent(transport: Transport): Content {
  return {
    async get(target, options = {}) {
      let query: Record<string, string | number>;
      let tags: string[];
      if ("path" in target) {
        const path = normalizeSeoPath(target.path);
        query = { path };
        tags = [`path:${path}`];
      } else if (target.type === "post") {
        query = { type: "post", id: target.id };
        tags = target.postType ? [`${target.postType}:${target.id}`] : [];
      } else {
        query = { type: "term", taxonomy: target.taxonomy, id: target.id };
        tags = [`term:${target.taxonomy}:${target.id}`];
      }
      if (options.previewToken) query.preview_token = options.previewToken;
      try {
        return await transport.request<ContentResult>("/store/content", {
          query,
          module: "content",
          // Previews are drafts: never cache them.
          cacheTags: options.previewToken ? undefined : tags,
          revalidate: options.revalidate,
          fetchOptions: options.previewToken ? { cache: "no-store" } : undefined,
          signal: options.signal,
        });
      } catch (error) {
        if (isHeadpressError(error) && error.status === 404 && error.code !== "headpress_module_disabled") return null;
        throw error;
      }
    },
    menus(options = {}) {
      return transport.request("/store/menus", { module: "content", cacheTags: ["menu:list"], signal: options.signal });
    },
    async menu(locationOrSlug, options = {}) {
      try {
        return await transport.request<Menu>(`/store/menus/${encodeURIComponent(locationOrSlug)}`, {
          module: "content",
          cacheTags: [`menu:${locationOrSlug}`],
          signal: options.signal,
        });
      } catch (error) {
        if (isHeadpressError(error) && error.status === 404 && error.code !== "headpress_module_disabled") return null;
        throw error;
      }
    },
    verifyPreview(token, options = {}) {
      return transport.request("/store/preview/verify", {
        query: { token },
        module: "content",
        fetchOptions: { cache: "no-store" },
        signal: options.signal,
      });
    },
  };
}
