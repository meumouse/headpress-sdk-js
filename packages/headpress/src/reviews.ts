/**
 * Product reviews (Headpress `reviews` module).
 *
 * - Public reads (lists, summaries, media) go out without the customer's token so they stay
 *   cacheable; personal ones (eligibility, votes, submitting) carry it when signed in.
 * - Guests vote with a random voter id kept in the browser (`X-Headpress-Voter`).
 * - Media limits come from `config.modules.reviews.media`; check files against them before upload,
 *   the server checks again.
 *
 * Reviews keep Headpress's keys; `content` is plain text — render it as text.
 */
import { isHeadpressError } from "./errors.js";
import type { Transport } from "./transport.js";

export interface ReviewMedia {
  id: number;
  type: "image" | "video";
  url: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  sizes?: Record<string, { url: string; width: number; height: number } | null>;
  duration: number | null;
}

export interface Review {
  id: number;
  product_id: number;
  rating: number | null;
  title: string;
  /** Plain text with `\n` line breaks. */
  content: string;
  author: { name: string | null; anonymous: boolean; avatar: string | null };
  verified: boolean;
  created_at: string;
  media: ReviewMedia[];
  helpful_count: number;
  reply: { content: string; created_at: string; author: { name: string } } | null;
  [key: string]: unknown;
}

export interface ReviewSummary {
  product_id: number;
  average: number;
  count: number;
  rated: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  with_media: number;
  verified: number;
  reviews_allowed: boolean;
}

export interface ReviewEligibility {
  can_review: boolean;
  reason: "reviews_closed" | "login_required" | "not_verified_owner" | "already_reviewed" | (string & {}) | null;
  verified: boolean | null;
}

export interface ReviewUpload extends ReviewMedia {
  token: string;
  expires_at: string;
}

export type ReviewSort = "newest" | "oldest" | "rating_desc" | "rating_asc" | "most_helpful";

export interface ReviewInput {
  rating?: number;
  title?: string;
  content: string;
  anonymous?: boolean;
  media?: readonly { id: number; token: string }[];
  /** Guests only, while the store accepts guest reviews. */
  author_name?: string;
  author_email?: string;
}

export interface Reviews {
  list(
    productId: number,
    query?: { page?: number; perPage?: number; rating?: readonly number[]; withMedia?: boolean; verified?: boolean; sort?: ReviewSort },
  ): Promise<{ items: Review[]; total: number; totalPages: number }>;
  summary(productId: number): Promise<ReviewSummary>;
  /** Photos and videos of approved reviews. */
  media(productId: number, query?: { page?: number; perPage?: number }): Promise<{ items: (ReviewMedia & { review_id?: number })[]; total: number; totalPages: number }>;
  /** A review, or null when it is not an approved review of a public product. */
  get(reviewId: number): Promise<Review | null>;
  eligibility(productId: number): Promise<ReviewEligibility>;
  /** Reviews of this product the shopper voted helpful. */
  votes(productId: number): Promise<number[]>;
  create(productId: number, input: ReviewInput, options?: { captcha?: string }): Promise<{ status: "approved" | "pending"; review: Review }>;
  /** Upload one photo or video; send `{ id, token }` with the review. */
  uploadMedia(file: Blob, options?: { filename?: string; signal?: AbortSignal }): Promise<ReviewUpload>;
  deleteMedia(id: number, token: string): Promise<void>;
  /** Vote a review helpful (`true`) or take the vote back (`false`). */
  vote(reviewId: number, helpful?: boolean): Promise<{ id: number; helpful_count: number; voted: boolean }>;
}

export function normalizeReview(raw: Record<string, unknown>): Review {
  const author = (raw.author && typeof raw.author === "object" ? raw.author : {}) as Record<string, unknown>;
  return {
    ...(raw as Review),
    rating: typeof raw.rating === "number" ? raw.rating : null,
    title: typeof raw.title === "string" ? raw.title : "",
    content: typeof raw.content === "string" ? raw.content : "",
    author: {
      name: typeof author.name === "string" ? author.name : null,
      anonymous: author.anonymous === true,
      avatar: typeof author.avatar === "string" ? author.avatar : null,
    },
    verified: raw.verified === true,
    media: Array.isArray(raw.media) ? (raw.media as ReviewMedia[]) : [],
    helpful_count: Number(raw.helpful_count) || 0,
    reply: (raw.reply as Review["reply"]) ?? null,
  };
}

/** A random guest voter id (16–64 of `[A-Za-z0-9_-]`), kept in `localStorage`. */
export function reviewVoterId(storageKey = "hp_review_voter"): string {
  const create = (): string => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  try {
    if (typeof localStorage === "undefined") return create();
    const existing = localStorage.getItem(storageKey);
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const id = create();
    localStorage.setItem(storageKey, id);
    return id;
  } catch {
    return create();
  }
}

export function createReviews(transport: Transport, voterId: () => string = reviewVoterId): Reviews {
  const voter = (): Record<string, string> => ({ "X-Headpress-Voter": voterId() });

  async function paged<T>(path: string, query: Record<string, unknown>, tags: string[]) {
    const response = await transport.raw<T[]>(path, {
      query: query as Record<string, string | number | boolean | undefined>,
      module: "reviews",
      cacheTags: tags,
    });
    const items = Array.isArray(response.data) ? response.data : [];
    return {
      items,
      total: Number(response.headers.get("X-WP-Total") ?? items.length) || 0,
      totalPages: Number(response.headers.get("X-WP-TotalPages") ?? 1) || 0,
    };
  }

  return {
    async list(productId, query = {}) {
      const page = await paged<Record<string, unknown>>(
        `/store/products/${productId}/reviews`,
        {
          page: query.page,
          per_page: query.perPage,
          rating: query.rating?.join(","),
          with_media: query.withMedia,
          verified: query.verified,
          sort: query.sort,
        },
        [`reviews:product:${productId}`],
      );
      return { ...page, items: page.items.map(normalizeReview) };
    },
    summary: (productId) =>
      transport.request(`/store/products/${productId}/reviews/summary`, { module: "reviews", cacheTags: [`reviews:product:${productId}`] }),
    media: (productId, query = {}) =>
      paged(`/store/products/${productId}/reviews/media`, { page: query.page, per_page: query.perPage }, [`reviews:product:${productId}`]),
    async get(reviewId) {
      try {
        return normalizeReview(await transport.request<Record<string, unknown>>(`/store/reviews/${reviewId}`, { module: "reviews" }));
      } catch (error) {
        if (isHeadpressError(error, "headpress_not_found")) return null;
        throw error;
      }
    },
    eligibility: (productId) =>
      transport.request(`/store/products/${productId}/reviews/eligibility`, { auth: "optional", module: "reviews", fetchOptions: { cache: "no-store" } }),
    async votes(productId) {
      const data = await transport.request<{ review_ids?: number[] }>(`/store/products/${productId}/reviews/votes`, {
        auth: "optional",
        headers: voter(),
        module: "reviews",
        fetchOptions: { cache: "no-store" },
      });
      return Array.isArray(data.review_ids) ? data.review_ids : [];
    },
    async create(productId, input, options = {}) {
      const data = await transport.request<{ status: "approved" | "pending"; review: Record<string, unknown> }>(
        `/store/products/${productId}/reviews`,
        { method: "POST", body: input, auth: "optional", captcha: options.captcha, module: "reviews" },
      );
      return { status: data.status, review: normalizeReview(data.review) };
    },
    uploadMedia(file, options = {}) {
      const form = new FormData();
      form.set("file", file, options.filename ?? (file as File).name ?? "upload");
      return transport.request<ReviewUpload>("/store/reviews/media", {
        method: "POST",
        body: form,
        auth: "optional",
        module: "reviews",
        signal: options.signal,
        // Videos up to 50 MB take longer than a JSON call.
        timeoutMs: 120_000,
      });
    },
    async deleteMedia(id, token) {
      await transport.request(`/store/reviews/media/${id}`, { method: "DELETE", query: { token }, auth: "optional", module: "reviews" });
    },
    vote: (reviewId, helpful = true) =>
      transport.request(`/store/reviews/${reviewId}/helpful`, {
        method: helpful ? "POST" : "DELETE",
        auth: "optional",
        headers: voter(),
        module: "reviews",
      }),
  };
}
