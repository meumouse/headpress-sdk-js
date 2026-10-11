"use client";

/**
 * Product reviews for Headpress stores (`reviews` module): the summary (average, one bar per star,
 * count) and the list, with sort and star filters, photos and videos, the verified-purchase badge,
 * the store's reply and the "helpful" vote.
 *
 * What is shown follows `config.modules.reviews` (verified label, replies, avatars, helpful votes and
 * whether guests may vote). Votes are optimistic: the count moves at once and settles on the
 * server's number.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { BadgeCheck, Loader2, Play, Star, Store, ThumbsUp } from "lucide-react";

import type { Review, ReviewMedia, ReviewSort, ReviewSummary } from "@meumouse.com/headpress";
import { useCapability, useFormatError, useHeadpress, useSignedIn, useStoreConfig } from "@meumouse.com/headpress/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface HeadpressProductReviewsLabels {
  heading?: string;
  outOf?: string;
  count?: (count: number) => string;
  stars?: (stars: number) => string;
  starFilter?: (stars: number, count: number, active: boolean) => string;
  ratingValue?: (rating: string) => string;
  clearFilter?: string;
  sortLabel?: string;
  sort?: Partial<Record<ReviewSort, string>>;
  empty?: string;
  emptyFiltered?: string;
  verified?: string;
  anonymous?: string;
  customer?: string;
  reply?: (author: string) => string;
  storeName?: string;
  helpful?: (count: number) => string;
  helpfulSignIn?: string;
  loadMore?: string;
  loading?: string;
  showing?: (shown: number, total: number) => string;
  readMore?: string;
  readLess?: string;
  openPhoto?: (index: number, author: string) => string;
  openVideo?: (index: number, author: string) => string;
  mediaDialog?: string;
  loadError?: string;
  retry?: string;
}

const SORTS: ReviewSort[] = ["newest", "most_helpful", "rating_desc", "rating_asc", "oldest"];

const DEFAULT_LABELS: Required<HeadpressProductReviewsLabels> = {
  heading: "Avaliações",
  outOf: "de 5",
  count: (count) => (count === 1 ? "1 avaliação" : `${count} avaliações`),
  stars: (stars) => (stars === 1 ? "1 estrela" : `${stars} estrelas`),
  starFilter: (stars, count, active) =>
    `${stars === 1 ? "1 estrela" : `${stars} estrelas`}: ${count === 1 ? "1 avaliação" : `${count} avaliações`}${active ? " (filtro ativo)" : ""}`,
  ratingValue: (rating) => `Nota ${rating} de 5`,
  clearFilter: "Limpar filtro",
  sortLabel: "Ordenar por",
  sort: {
    newest: "Mais recentes",
    most_helpful: "Mais úteis",
    rating_desc: "Maior nota",
    rating_asc: "Menor nota",
    oldest: "Mais antigas",
  },
  empty: "Este produto ainda não tem avaliações.",
  emptyFiltered: "Nenhuma avaliação com este filtro.",
  verified: "Compra verificada",
  anonymous: "Cliente anônimo",
  customer: "Cliente",
  reply: (author) => `Resposta de ${author}`,
  storeName: "Loja",
  helpful: (count) => (count > 0 ? `Útil (${count})` : "Útil"),
  helpfulSignIn: "Entre na sua conta para votar.",
  loadMore: "Ver mais avaliações",
  loading: "Carregando avaliações…",
  showing: (shown, total) => `Mostrando ${shown} de ${total} avaliações`,
  readMore: "Ler mais",
  readLess: "Ler menos",
  openPhoto: (index, author) => `Ver foto ${index} da avaliação de ${author}`,
  openVideo: (index, author) => `Ver vídeo ${index} da avaliação de ${author}`,
  mediaDialog: "Mídia da avaliação",
  loadError: "Não foi possível carregar as avaliações.",
  retry: "Tentar de novo",
};

export interface HeadpressProductReviewsProps {
  productId: number;
  /** Reviews per page; defaults to `config.modules.reviews.per_page`. */
  perPage?: number;
  /** Rendered under the average, e.g. a button that opens `HeadpressReviewForm`. */
  action?: ReactNode;
  /** Characters before "read more". */
  clampAt?: number;
  labels?: HeadpressProductReviewsLabels;
  className?: string;
}

function Stars({ rating, label, className }: { rating: number; label: string; className?: string }) {
  return (
    <span role="img" aria-label={label} className={cn("inline-flex items-center gap-0.5", className)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          aria-hidden="true"
          className={cn("size-4", rating >= star - 0.25 ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")}
        />
      ))}
    </span>
  );
}

function thumbnailUrl(media: ReviewMedia): string {
  return media.sizes?.thumbnail?.url || media.sizes?.medium?.url || media.url;
}

export function HeadpressProductReviews({ productId, perPage, action, clampAt = 420, labels, className }: HeadpressProductReviewsProps) {
  const text = { ...DEFAULT_LABELS, ...labels, sort: { ...DEFAULT_LABELS.sort, ...labels?.sort } };
  const hp = useHeadpress();
  const config = useStoreConfig();
  const settings = useCapability("reviews");
  const signedIn = useSignedIn();
  const formatError = useFormatError();
  const locale = hp.locale();

  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [items, setItems] = useState<Review[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [fetchStatus, setFetchStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [sort, setSort] = useState<ReviewSort>("newest");
  const [rating, setRating] = useState<number | null>(null);
  const [voted, setVoted] = useState<Set<number>>(() => new Set());
  const [voting, setVoting] = useState<Set<number>>(() => new Set());
  const [notice, setNotice] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [lightbox, setLightbox] = useState<{ review: Review; index: number } | null>(null);
  const sequence = useRef(0);
  const headingId = useId();
  const sortId = useId();

  const size = perPage ?? settings?.per_page ?? 10;
  const helpfulOn = settings?.helpful_enabled === true;
  const canVote = helpfulOn && (signedIn || settings?.helpful_guests === true);

  const numberFormat = useMemo(() => new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), [locale]);
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale]);

  // What the list is fetched for. `status` reads "loading" until the first page of this query lands,
  // so a new product, sort, star filter or store config shows the loading state without an effect
  // setting it.
  const query = useMemo(() => ({ hp, productId, size, sort, rating, settings }), [hp, productId, size, sort, rating, settings]);
  const [loadedQuery, setLoadedQuery] = useState<typeof query | null>(null);
  const status = loadedQuery === query ? fetchStatus : "loading";

  // State is only set in the promise callbacks, after the answer arrives.
  const fetchPage = useCallback(
    (nextPage: number, id: number) =>
      query.hp.reviews
        .list(query.productId, { page: nextPage, perPage: query.size, sort: query.sort, rating: query.rating ? [query.rating] : undefined })
        .then((result) => {
          if (id !== sequence.current) return;
          setItems((current) => (nextPage === 1 ? result.items : [...current, ...result.items]));
          setTotal(result.total);
          setTotalPages(result.totalPages);
          setPage(nextPage);
          setFetchStatus("ready");
          setLoadedQuery(query);
          if (nextPage > 1) setAnnouncement(text.showing(Math.min(result.total, nextPage * query.size), result.total));
        })
        .catch(() => {
          if (id !== sequence.current) return;
          if (nextPage === 1) {
            setFetchStatus("error");
            setLoadedQuery(query);
          } else setNotice(text.loadError);
        })
        .finally(() => {
          if (id === sequence.current) setLoadingMore(false);
        }),
    // `text` is rebuilt every render; the strings it reads do not change what is fetched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query],
  );

  /** Retry or "load more", from a click. */
  const load = (nextPage: number) => {
    const id = ++sequence.current;
    if (nextPage === 1) setFetchStatus("loading");
    else setLoadingMore(true);
    return fetchPage(nextPage, id);
  };

  useEffect(() => {
    if (!settings) return;
    void fetchPage(1, ++sequence.current);
  }, [settings, fetchPage]);

  useEffect(() => {
    if (!settings) return;
    let cancelled = false;
    hp.reviews
      .summary(productId)
      .then((value) => {
        if (!cancelled) setSummary(value);
      })
      .catch(() => undefined);
    if (helpfulOn) {
      hp.reviews
        .votes(productId)
        .then((ids) => {
          if (!cancelled) setVoted(new Set(ids));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [hp, productId, settings, helpfulOn, signedIn]);

  const toggleVote = async (review: Review) => {
    if (voting.has(review.id)) return;
    const wasVoted = voted.has(review.id);
    const patchCount = (count: number) =>
      setItems((current) => current.map((entry) => (entry.id === review.id ? { ...entry, helpful_count: count } : entry)));
    const setMembership = (on: boolean) =>
      setVoted((current) => {
        const next = new Set(current);
        if (on) next.add(review.id);
        else next.delete(review.id);
        return next;
      });

    // Optimistic: move the count now, settle on the server's number.
    setVoting((current) => new Set(current).add(review.id));
    setMembership(!wasVoted);
    patchCount(Math.max(0, review.helpful_count + (wasVoted ? -1 : 1)));
    try {
      const answer = await hp.reviews.vote(review.id, !wasVoted);
      patchCount(answer.helpful_count);
      setMembership(answer.voted);
    } catch (error) {
      patchCount(review.helpful_count);
      setMembership(wasVoted);
      setNotice(formatError(error, "reviews"));
    } finally {
      setVoting((current) => {
        const next = new Set(current);
        next.delete(review.id);
        return next;
      });
    }
  };

  // The module is off: nothing to show.
  if (config && !settings) return null;

  const authorName = (review: Review) => (review.author.anonymous ? text.anonymous : review.author.name || text.customer);
  const rated = summary ? Math.max(0, summary.rated) : 0;
  const lightboxMedia = lightbox ? lightbox.review.media[lightbox.index] : undefined;

  return (
    <section className={cn("space-y-8", className)} aria-labelledby={headingId} data-slot="headpress-product-reviews">
      <h2 id={headingId} className="text-2xl font-semibold tracking-tight">
        {text.heading}
      </h2>

      {summary ? (
        <div className="grid gap-8 rounded-xl border bg-card p-6 md:grid-cols-[minmax(0,14rem)_1px_minmax(0,1fr)] md:items-center">
          <div className="flex flex-col items-center text-center">
            <p className="text-5xl font-semibold leading-none tabular-nums">
              {numberFormat.format(summary.average)}
              <span className="ml-1 text-base font-normal text-muted-foreground">{text.outOf}</span>
            </p>
            <Stars rating={summary.average} label={text.ratingValue(numberFormat.format(summary.average))} className="mt-3" />
            <p className="mt-2 text-sm text-muted-foreground">{text.count(summary.count)}</p>
            {action && <div className="mt-5 w-full">{action}</div>}
          </div>
          <Separator orientation="vertical" className="hidden md:block" />
          <ul className="space-y-2">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = summary.distribution[String(star) as keyof ReviewSummary["distribution"]] ?? 0;
              const width = rated > 0 ? Math.round((count / rated) * 100) : 0;
              const isActive = rating === star;
              return (
                <li key={star}>
                  <button
                    type="button"
                    onClick={() => setRating(isActive ? null : star)}
                    disabled={count === 0 && !isActive}
                    aria-pressed={isActive}
                    aria-label={text.starFilter(star, count, isActive)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-1.5 py-1 text-sm transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:bg-accent disabled:cursor-default",
                      isActive && "bg-accent",
                    )}
                  >
                    <span className="w-20 shrink-0 whitespace-nowrap text-left">{text.stars(star)}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <span className={cn("block h-full rounded-full bg-amber-400", isActive && "bg-primary")} style={{ width: `${width}%` }} />
                    </span>
                    <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">{count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : status !== "error" ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {rating !== null && (
            <Button type="button" variant="outline" size="sm" onClick={() => setRating(null)}>
              {text.stars(rating)} · {text.clearFilter}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span id={sortId} className="text-sm text-muted-foreground">
            {text.sortLabel}
          </span>
          <Select value={sort} onValueChange={(value) => setSort(value as ReviewSort)}>
            <SelectTrigger size="sm" aria-labelledby={sortId} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((value) => (
                <SelectItem key={value} value={value}>
                  {text.sort[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div aria-busy={status === "loading" || loadingMore}>
        {status === "loading" && (
          <div className="space-y-6" aria-label={text.loading}>
            {[0, 1, 2].map((index) => (
              <div key={index} className="space-y-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        )}

        {status === "error" && (
          <div className="rounded-lg border p-6 text-center">
            <p className="text-sm text-muted-foreground">{text.loadError}</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void load(1)}>
              {text.retry}
            </Button>
          </div>
        )}

        {status === "ready" && items.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">{rating !== null ? text.emptyFiltered : text.empty}</p>
        )}

        {status === "ready" && items.length > 0 && (
          <ul className="divide-y">
            {items.map((review) => (
              <li key={review.id}>
                <ReviewArticle
                  review={review}
                  name={authorName(review)}
                  date={dateFormat}
                  showVerified={settings?.show_verified_label !== false}
                  showAvatar={settings?.show_avatars === true}
                  showReply={settings?.show_replies !== false}
                  clampAt={clampAt}
                  text={text}
                  ratingText={(value) => text.ratingValue(numberFormat.format(value))}
                  helpful={
                    helpfulOn
                      ? {
                          voted: voted.has(review.id),
                          disabled: voting.has(review.id),
                          // Guests who may not vote learn why instead of meeting a dead button.
                          onToggle: canVote ? () => void toggleVote(review) : () => setNotice(text.helpfulSignIn),
                        }
                      : undefined
                  }
                  onOpenMedia={(index) => setLightbox({ review, index })}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-center text-sm text-muted-foreground empty:hidden" role="status" aria-live="polite">
        {notice}
      </p>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {status === "ready" && page < totalPages && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs text-muted-foreground">{text.showing(items.length, total)}</p>
          <Button type="button" variant="outline" onClick={() => void load(page + 1)} disabled={loadingMore}>
            {loadingMore && <Loader2 className="animate-spin" aria-hidden="true" />}
            {text.loadMore}
          </Button>
        </div>
      )}

      <Dialog open={lightbox !== null} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent className="max-w-3xl p-2 sm:max-w-3xl">
          <DialogTitle className="sr-only">{text.mediaDialog}</DialogTitle>
          <DialogDescription className="sr-only">{lightbox ? authorName(lightbox.review) : ""}</DialogDescription>
          {lightboxMedia &&
            (lightboxMedia.type === "video" ? (
              <video src={lightboxMedia.url} controls autoPlay playsInline className="max-h-[80vh] w-full rounded-md bg-black" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lightboxMedia.url} alt="" className="max-h-[80vh] w-full rounded-md object-contain" />
            ))}
          {lightbox && lightbox.review.media.length > 1 && (
            <div className="flex justify-center gap-2 p-2">
              {lightbox.review.media.map((media, index) => (
                <button
                  key={media.id}
                  type="button"
                  onClick={() => setLightbox({ review: lightbox.review, index })}
                  aria-label={(media.type === "video" ? text.openVideo : text.openPhoto)(index + 1, authorName(lightbox.review))}
                  aria-current={index === lightbox.index}
                  className={cn("size-12 overflow-hidden rounded-md border-2", index === lightbox.index ? "border-primary" : "border-transparent")}
                >
                  {media.type === "video" ? (
                    <span className="flex size-full items-center justify-center bg-muted">
                      <Play className="size-4" aria-hidden="true" />
                    </span>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbnailUrl(media)} alt="" className="size-full object-cover" />
                  )}
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ReviewArticle({
  review,
  name,
  date,
  showVerified,
  showAvatar,
  showReply,
  clampAt,
  text,
  ratingText,
  helpful,
  onOpenMedia,
}: {
  review: Review;
  name: string;
  date: Intl.DateTimeFormat;
  showVerified: boolean;
  showAvatar: boolean;
  showReply: boolean;
  clampAt: number;
  text: Required<HeadpressProductReviewsLabels>;
  ratingText: (rating: number) => string;
  helpful?: { voted: boolean; disabled: boolean; onToggle: () => void };
  onOpenMedia: (index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = review.content.length > clampAt;
  const content = long && !expanded ? `${review.content.slice(0, clampAt).trimEnd()}…` : review.content;
  const created = Date.parse(review.created_at);
  const initial = (review.author.anonymous ? "?" : name.trim()[0] || "?").toUpperCase();

  return (
    <article className="py-6">
      <header className="flex items-start gap-3">
        {showAvatar && (
          <span aria-hidden="true" className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-medium">
            {initial}
            {review.author.avatar && !review.author.anonymous && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={review.author.avatar} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
            )}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{name}</span>
            {showVerified && review.verified && (
              <Badge variant="secondary" className="gap-1">
                <BadgeCheck aria-hidden="true" />
                {text.verified}
              </Badge>
            )}
          </div>
          {!Number.isNaN(created) && (
            <time dateTime={review.created_at} className="text-xs text-muted-foreground">
              {date.format(created)}
            </time>
          )}
        </div>
      </header>

      <div className={cn("mt-3 space-y-2", showAvatar && "sm:pl-[3.25rem]")}>
        {review.rating ? <Stars rating={review.rating} label={ratingText(review.rating)} /> : null}
        {review.title && <h3 className="font-semibold leading-snug">{review.title}</h3>}
        {review.content && (
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
            {content}
            {long && (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                className="ml-1 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {expanded ? text.readLess : text.readMore}
              </button>
            )}
          </p>
        )}

        {review.media.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {review.media.map((media, index) => (
              <button
                key={media.id}
                type="button"
                onClick={() => onOpenMedia(index)}
                aria-label={(media.type === "video" ? text.openVideo : text.openPhoto)(index + 1, name)}
                className="relative size-20 overflow-hidden rounded-lg border bg-muted transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {media.type === "video" ? (
                  <>
                    <video src={`${media.url}#t=0.1`} preload="metadata" muted playsInline className="size-full object-cover" />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                      <Play className="size-6 fill-white text-white" aria-hidden="true" />
                    </span>
                  </>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbnailUrl(media)} alt="" loading="lazy" className="size-full object-cover" />
                )}
              </button>
            ))}
          </div>
        )}

        {showReply && review.reply && (
          <div className="mt-3 rounded-lg bg-muted p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <Store className="size-3.5" aria-hidden="true" />
              {text.reply(review.reply.author.name || text.storeName)}
            </p>
            <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-foreground/90">{review.reply.content}</p>
          </div>
        )}

        {helpful && (
          <div className="pt-2">
            <Button
              type="button"
              variant={helpful.voted ? "secondary" : "outline"}
              size="sm"
              className="rounded-full"
              onClick={helpful.onToggle}
              disabled={helpful.disabled}
              aria-pressed={helpful.voted}
            >
              <ThumbsUp className={cn(helpful.voted && "fill-current")} aria-hidden="true" />
              {text.helpful(review.helpful_count)}
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

export default HeadpressProductReviews;
