import Link from "next/link";

import { moneyFromDecimal, toMajor, type ProductOrderBy, type ProductQuery } from "@meumouse.com/headpress";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hp } from "@/lib/headpress";
import { ProductGrid } from "@/modules/products/components/product-card";

type SearchParams = Record<string, string | string[] | undefined>;

const PER_PAGE = 12;

const SORTS: Record<string, { label: string; orderby: ProductOrderBy; order: "asc" | "desc" }> = {
  menu_order: { label: "Padrão da loja", orderby: "menu_order", order: "asc" },
  popularity: { label: "Mais vendidos", orderby: "popularity", order: "desc" },
  rating: { label: "Mais bem avaliados", orderby: "rating", order: "desc" },
  date: { label: "Mais recentes", orderby: "date", order: "desc" },
  price: { label: "Menor preço", orderby: "price", order: "asc" },
  "price-desc": { label: "Maior preço", orderby: "price", order: "desc" },
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export interface CatalogTemplateProps {
  title: string;
  /** HTML from WordPress (term description). */
  description?: string;
  /** The listing's fixed filter: a category, a tag, or nothing (shop). */
  base: Pick<ProductQuery, "category" | "tag">;
  /** This page's own path, for the filter form and pagination. */
  path: string;
  searchParams: SearchParams;
}

/**
 * Product listing with the Store API's own filters: price range bounds from `catalog.facets()`
 * (`/products/collection-data`), sort, search and pages. Bounds typed by the shopper are parsed into
 * minor units with `moneyFromDecimal()`; the server does the filtering.
 */
export async function CatalogTemplate({ title, description, base, path, searchParams }: CatalogTemplateProps) {
  const config = await hp.config.get();
  const currency = config.commerce?.currency.code ?? "BRL";
  const minorUnit = config.commerce?.currency.minor_unit;

  const sortKey = first(searchParams.orderby) in SORTS ? first(searchParams.orderby) : "menu_order";
  const sort = SORTS[sortKey]!;
  const search = first(searchParams.q);
  const page = Math.max(1, Number.parseInt(first(searchParams.page), 10) || 1);
  const parseBound = (value: string) => (value ? moneyFromDecimal(value.replace(",", "."), currency, minorUnit) : null);
  const minPrice = parseBound(first(searchParams.min_price));
  const maxPrice = parseBound(first(searchParams.max_price));

  const query: ProductQuery = {
    ...base,
    ...(search ? { search } : {}),
    ...(minPrice ? { minPrice } : {}),
    ...(maxPrice ? { maxPrice } : {}),
    orderby: sort.orderby,
    order: sort.order,
  };

  const [list, facets] = await Promise.all([
    hp.catalog.list({ ...query, page, perPage: PER_PAGE }),
    // Bounds of the whole listing (without the shopper's own price filter), for the inputs' hints.
    hp.catalog.facets({ ...base, ...(search ? { search } : {}) }, { price: true }),
  ]);

  const range = facets.priceRange;
  const href = (nextPage: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      const text = first(value);
      if (text && key !== "page") params.set(key, text);
    }
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{search ? `Resultados para “${search}”` : title}</h1>
        {description && <div className="wp-content text-muted-foreground" dangerouslySetInnerHTML={{ __html: description }} />}
        <p className="text-sm text-muted-foreground">{list.total === 1 ? "1 produto" : `${list.total} produtos`}</p>
      </header>

      <form method="get" action={path} className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
        {search && <input type="hidden" name="q" value={search} />}
        <div className="grid gap-1.5">
          <Label htmlFor="orderby">Ordenar por</Label>
          <select
            id="orderby"
            name="orderby"
            defaultValue={sortKey}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
          >
            {Object.entries(SORTS).map(([key, option]) => (
              <option key={key} value={key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="min_price">Preço mínimo</Label>
          <Input
            id="min_price"
            name="min_price"
            inputMode="decimal"
            className="w-32"
            defaultValue={first(searchParams.min_price)}
            placeholder={range ? String(Math.floor(toMajor(range.min))) : undefined}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="max_price">Preço máximo</Label>
          <Input
            id="max_price"
            name="max_price"
            inputMode="decimal"
            className="w-32"
            defaultValue={first(searchParams.max_price)}
            placeholder={range ? String(Math.ceil(toMajor(range.max))) : undefined}
          />
        </div>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        {range && (
          <p className="w-full text-xs text-muted-foreground">
            Preços de {hp.formatMoney(range.min)} a {hp.formatMoney(range.max)}
          </p>
        )}
      </form>

      <ProductGrid products={list.items} />

      {list.totalPages > 1 && (
        <nav className="flex items-center justify-center gap-4 text-sm" aria-label="Páginas">
          {page > 1 ? <Link href={href(page - 1)}>← Anterior</Link> : <span />}
          <span className="text-muted-foreground">
            Página {page} de {list.totalPages}
          </span>
          {page < list.totalPages ? <Link href={href(page + 1)}>Próxima →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
