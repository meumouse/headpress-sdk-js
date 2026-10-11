"use client";

/**
 * Command-palette search for Headpress stores (`search` module).
 *
 * Suggestions come grouped from the server (products, terms, posts), with the matched words
 * highlighted, a "did you mean" phrase and merchandising redirects. The dialog never routes by
 * itself: every destination goes through `onNavigate(path)`, so it works with any router.
 *
 * Keyboard: type to search, ArrowUp/ArrowDown (or Home/End) to move, Enter to open the active
 * item (or the redirect / full results when none is active), Escape to close.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Loader2, Search, TrendingUp, X } from "lucide-react";

import { highlightSegments, type HighlightRange, type SearchItem, type SearchProduct } from "@meumouse.com/headpress";
import type { SearchBoxOptions } from "@meumouse.com/headpress/controllers";
import { useCapability, useFormatError, useFormatMoney, useHeadpress, useSearchBox } from "@meumouse.com/headpress/react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface HeadpressSearchDialogLabels {
  title?: string;
  description?: string;
  placeholder?: string;
  clear?: string;
  popular?: string;
  tooShort?: (minChars: number) => string;
  loading?: string;
  empty?: string;
  emptyHint?: string;
  error?: string;
  didYouMean?: string;
  partial?: string;
  from?: string;
  sku?: (sku: string) => string;
  /** Group heading by the server's group type (`products`, `categories`, `posts`…). */
  group?: (type: string) => string;
  viewAll?: (total: number) => string;
  /** Screen-reader summary once results arrive. */
  resultsAnnouncement?: (count: number) => string;
}

const GROUP_TITLES: Record<string, string> = {
  products: "Produtos",
  categories: "Categorias",
  category: "Categorias",
  tags: "Tags",
  post_tag: "Tags",
  brands: "Marcas",
  posts: "Conteúdos",
  pages: "Páginas",
};

const DEFAULT_LABELS: Required<HeadpressSearchDialogLabels> = {
  title: "Buscar na loja",
  description: "Digite para ver sugestões. Use as setas para navegar e Enter para abrir.",
  placeholder: "O que você procura?",
  clear: "Limpar busca",
  popular: "Buscas populares",
  tooShort: (minChars) => `Digite pelo menos ${minChars} ${minChars === 1 ? "letra" : "letras"}.`,
  loading: "Buscando…",
  empty: "Nada encontrado",
  emptyHint: "Tente outro termo de busca.",
  error: "Não foi possível buscar agora.",
  didYouMean: "Você quis dizer",
  partial: "Nenhum resultado tem todas as palavras; estes são os mais próximos.",
  from: "a partir de",
  sku: (sku) => `Ref. ${sku}`,
  group: (type) => GROUP_TITLES[type] ?? type,
  viewAll: (total) => (total > 1 ? `Ver todos os ${total} resultados` : "Ver resultado"),
  resultsAnnouncement: (count) => (count === 1 ? "1 sugestão" : `${count} sugestões`),
};

export interface HeadpressSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Go to a path (or absolute URL, for redirects to another site). The dialog closes first. */
  onNavigate: (path: string) => void;
  /** Path of the full results page for a phrase; omit to hide "view all" and keep Enter on items. */
  resultsPath?: (query: string) => string | null;
  /** Called when an item is opened, e.g. to send `hp.search.track()` click events. */
  onSelect?: (item: SearchItem, position: number, query: string) => void;
  /** Show the store's popular searches while the box is empty. Defaults to true. */
  showPopular?: boolean;
  searchOptions?: SearchBoxOptions;
  labels?: HeadpressSearchDialogLabels;
  className?: string;
}

interface Row {
  key: string;
  item: SearchItem;
  path: string;
  group: string;
}

function Highlighted({ text, ranges }: { text: string; ranges: readonly HighlightRange[] | undefined }) {
  return (
    <>
      {highlightSegments(text, ranges).map((segment, index) =>
        segment.match ? (
          <mark key={index} className="bg-transparent font-semibold text-primary">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

export function HeadpressSearchDialog({
  open,
  onOpenChange,
  onNavigate,
  resultsPath,
  onSelect,
  showPopular = true,
  searchOptions,
  labels,
  className,
}: HeadpressSearchDialogProps) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const hp = useHeadpress();
  const settings = useCapability("search");
  const formatMoney = useFormatMoney();
  const formatError = useFormatError();
  const [state, { setQuery, clear }] = useSearchBox(searchOptions);
  // The highlighted row belongs to the result it was picked in: a new result (or none, once the
  // dialog closes and the phrase is cleared) starts with no row highlighted.
  const [picked, setPicked] = useState<{ result: unknown; index: number }>({ result: null, index: -1 });
  const [popular, setPopular] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;

  const show = useMemo(() => new Set<string>(settings?.suggest_show ?? ["image", "price"]), [settings]);
  const minChars = searchOptions?.minChars ?? settings?.min_chars ?? 2;
  const result = state.result;

  // Forget the phrase when the dialog closes, so it opens fresh.
  useEffect(() => {
    if (!open) clear();
  }, [open, clear]);

  useEffect(() => {
    if (!open || !showPopular || popular.length) return;
    let cancelled = false;
    hp.search
      .popular({ limit: 8 })
      .then((entries) => {
        if (!cancelled) setPopular(entries.map((entry) => entry.phrase).filter(Boolean));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, showPopular, popular.length, hp]);

  const rows = useMemo<Row[]>(() => {
    if (!result) return [];
    const out: Row[] = [];
    for (const group of result.groups) {
      for (const item of group.items) {
        // An item without a storefront path has nowhere to go (its route is off in Headpress).
        if (!item.path) continue;
        out.push({ key: `${item.kind}-${group.type}-${item.id}`, item, path: item.path, group: group.type });
      }
    }
    return out;
  }, [result]);

  const active = picked.result === result ? picked.index : -1;
  const setActive = (next: number | ((index: number) => number)) =>
    setPicked((current) => {
      const index = current.result === result ? current.index : -1;
      return { result, index: typeof next === "function" ? next(index) : next };
    });

  const productTotal = result?.groups.find((group) => group.type === "products")?.total ?? result?.total ?? 0;
  const searching = state.status === "loading";
  const showResults = (state.status === "ready" || searching) && rows.length > 0;

  const close = () => onOpenChange(false);

  const go = (path: string) => {
    close();
    onNavigate(path);
  };

  const openRow = (row: Row, index: number) => {
    onSelect?.(row.item, index + 1, state.query.trim());
    go(row.path);
  };

  const submit = () => {
    const activeRow = rows[active];
    if (activeRow) {
      openRow(activeRow, active);
      return;
    }
    const phrase = state.query.trim();
    if (!phrase) return;
    // A redirect belongs to the phrase the server answered for, not to one still being typed.
    if (result?.redirect && state.status === "ready") {
      go(result.redirect);
      return;
    }
    const target = resultsPath?.(phrase);
    if (target) go(target);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!rows.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % rows.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index <= 0 ? rows.length - 1 : index - 1));
    } else if (event.key === "Home" && active >= 0) {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End" && active >= 0) {
      event.preventDefault();
      setActive(rows.length - 1);
    }
  };

  useEffect(() => {
    if (active < 0) return;
    document.getElementById(`${baseId}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, baseId]);

  const announcement =
    state.status === "loading"
      ? text.loading
      : state.status === "too_short"
        ? text.tooShort(minChars)
        : state.status === "error"
          ? text.error
          : state.status === "ready"
            ? rows.length
              ? text.resultsAnnouncement(rows.length)
              : text.empty
            : "";

  let groupSeen = "";
  const productPrice = (item: SearchProduct): ReactNode => {
    const prices = item.prices;
    if (!prices || !show.has("price")) return null;
    const varies = prices.range !== null && prices.range.min.amount !== prices.range.max.amount;
    return (
      <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
        {varies && prices.range ? (
          <>
            <span className="block text-[11px] font-normal text-muted-foreground">{text.from}</span>
            {formatMoney(prices.range.min)}
          </>
        ) : item.onSale && prices.regularPrice.amount !== prices.price.amount ? (
          <>
            <span className="block text-[11px] font-normal text-muted-foreground line-through">{formatMoney(prices.regularPrice)}</span>
            {formatMoney(prices.price)}
          </>
        ) : (
          formatMoney(prices.price)
        )}
      </span>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn("top-[10%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl", className)}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">{text.title}</DialogTitle>
        <DialogDescription className="sr-only">{text.description}</DialogDescription>

        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex items-center gap-3 border-b px-4 py-3"
        >
          <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={showResults}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${baseId}-option-${active}` : undefined}
            aria-label={text.title}
            enterKeyHint="search"
            autoComplete="off"
            value={state.query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={text.placeholder}
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          {searching ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : state.query ? (
            <button
              type="button"
              onClick={() => {
                clear();
                inputRef.current?.focus();
              }}
              aria-label={text.clear}
              className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </form>

        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>

        <div className="max-h-[60vh] overflow-y-auto">
          {state.status === "idle" && popular.length > 0 && (
            <div className="px-4 py-4">
              <p className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <TrendingUp className="size-3.5" aria-hidden="true" />
                {text.popular}
              </p>
              <div className="flex flex-wrap gap-2">
                {popular.map((phrase) => (
                  <button
                    key={phrase}
                    type="button"
                    onClick={() => {
                      setQuery(phrase);
                      inputRef.current?.focus();
                    }}
                    className="rounded-full bg-secondary px-3 py-1.5 text-sm text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {phrase}
                  </button>
                ))}
              </div>
            </div>
          )}

          {state.status === "too_short" && <p className="px-4 py-6 text-center text-sm text-muted-foreground">{text.tooShort(minChars)}</p>}

          {searching && rows.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              {text.loading}
            </div>
          )}

          {state.status === "error" && (
            <div className="px-4 py-10 text-center">
              <p className="font-medium text-foreground">{text.error}</p>
              <p className="mt-1 text-sm text-muted-foreground">{formatError(state.error, "search")}</p>
            </div>
          )}

          {result?.suggestion && settings?.did_you_mean !== false && state.status === "ready" && (
            <p className="px-4 pt-4 text-sm text-muted-foreground">
              {text.didYouMean}{" "}
              <button
                type="button"
                onClick={() => {
                  setQuery(result.suggestion ?? "");
                  inputRef.current?.focus();
                }}
                className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {result.suggestion}
              </button>
              ?
            </p>
          )}

          {state.status === "ready" && rows.length === 0 && (
            <div className="px-4 py-10 text-center">
              <p className="font-medium text-foreground">{text.empty}</p>
              <p className="mt-1 text-sm text-muted-foreground">{text.emptyHint}</p>
            </div>
          )}

          {result?.partial && showResults && <p className="px-4 pt-3 text-xs text-muted-foreground">{text.partial}</p>}

          {showResults && (
            <ul id={listId} role="listbox" aria-label={text.title} className="py-2">
              {rows.map((row, index) => {
                const heading = row.group !== groupSeen ? text.group(row.group) : null;
                groupSeen = row.group;
                const item = row.item;
                const selected = index === active;
                return (
                  <li key={row.key} role="presentation">
                    {heading && (
                      <p role="presentation" className="px-4 pt-3 pb-1 text-xs uppercase tracking-wider text-muted-foreground">
                        {heading}
                      </p>
                    )}
                    <div
                      id={`${baseId}-option-${index}`}
                      role="option"
                      aria-selected={selected}
                      tabIndex={-1}
                      onMouseMove={() => setActive(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => openRow(row, index)}
                      className={cn("flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm", selected && "bg-accent text-accent-foreground")}
                    >
                      {item.kind === "product" ? (
                        <>
                          {show.has("image") && (
                            <span className="size-12 shrink-0 overflow-hidden rounded-md bg-muted">
                              {item.image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={item.image.src} srcSet={item.image.srcset || undefined} sizes="48px" alt="" loading="lazy" className="size-full object-cover" />
                              ) : null}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            {show.has("sku") && item.sku && <span className="block text-xs text-muted-foreground">{text.sku(item.sku)}</span>}
                            <span className="line-clamp-2">
                              <Highlighted text={item.name} ranges={item.highlight.name} />
                            </span>
                          </span>
                          {productPrice(item)}
                        </>
                      ) : item.kind === "term" ? (
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-1">
                            <Highlighted text={item.name} ranges={item.highlight.name} />
                          </span>
                          {item.breadcrumbs.length > 0 && (
                            <span className="block truncate text-xs text-muted-foreground">{item.breadcrumbs.map((crumb) => crumb.name).join(" › ")}</span>
                          )}
                        </span>
                      ) : (
                        <span className="min-w-0 flex-1 line-clamp-1">
                          <Highlighted text={item.title} ranges={item.highlight.title} />
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {showResults && resultsPath && productTotal > 0 && (
          <div className="border-t px-4 py-3 text-center">
            <button
              type="button"
              onClick={() => {
                const target = resultsPath(state.query.trim());
                if (target) go(target);
              }}
              className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {text.viewAll(productTotal)} →
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default HeadpressSearchDialog;
