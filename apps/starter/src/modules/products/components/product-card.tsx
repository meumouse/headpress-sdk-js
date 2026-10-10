import Link from "next/link";

import type { Product } from "@meumouse/headpress";

import { HeadpressPrice } from "@/components/headpress-price";

/** A product tile. `product.path` comes from the route map; without a product route there is no link. */
export function ProductCard({ product }: { product: Product }) {
  const image = product.images[0];
  const body = (
    <>
      <div className="aspect-square overflow-hidden rounded-lg bg-muted">
        {image && (
          // WordPress already serves the responsive sizes (srcset), so a plain <img> is enough.
          <img
            src={image.thumbnail || image.src}
            srcSet={image.srcset || undefined}
            sizes="(min-width: 1024px) 25vw, 50vw"
            alt={image.alt || product.name}
            loading="lazy"
            className="size-full object-cover transition-transform group-hover:scale-105"
          />
        )}
      </div>
      <h3 className="mt-3 line-clamp-2 text-sm font-medium">{product.name}</h3>
      <HeadpressPrice product={product} size="sm" className="mt-1" />
      {!product.stock.inStock && <p className="mt-1 text-xs text-muted-foreground">Esgotado</p>}
    </>
  );
  return product.path ? (
    <Link href={product.path} className="group block">
      {body}
    </Link>
  ) : (
    <div className="group">{body}</div>
  );
}

export function ProductGrid({ products }: { products: Product[] }) {
  if (products.length === 0) return <p className="text-muted-foreground">Nenhum produto encontrado.</p>;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
