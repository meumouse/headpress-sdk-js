import Link from "next/link";

import type { Product } from "@meumouse.com/headpress";

import { HeadpressProductReviews } from "@/components/headpress-product-reviews";
import { Button } from "@/components/ui/button";
import { hp } from "@/lib/headpress";
import { ProductPurchase } from "@/modules/products/components/product-purchase";

export function ProductTemplate({ product, variations }: { product: Product; variations: Product[] }) {
  const [cover, ...gallery] = product.images;
  const reviewPath = hp.routes.path("product_review", { slug: product.slug });

  return (
    <article className="space-y-12">
      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-3">
          <div className="aspect-square overflow-hidden rounded-xl bg-muted">
            {cover && (
              <img
                src={cover.src}
                srcSet={cover.srcset || undefined}
                sizes="(min-width: 768px) 50vw, 100vw"
                alt={cover.alt || product.name}
                className="size-full object-cover"
              />
            )}
          </div>
          {gallery.length > 0 && (
            <div className="grid grid-cols-4 gap-3">
              {gallery.map((image) => (
                <img
                  key={image.id}
                  src={image.thumbnail || image.src}
                  alt={image.alt || product.name}
                  loading="lazy"
                  className="aspect-square rounded-md object-cover"
                />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <header className="space-y-2">
            {product.categories.length > 0 && (
              <nav className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {product.categories.map((category) =>
                  category.path ? (
                    <Link key={category.id} href={category.path} className="hover:text-foreground">
                      {category.name}
                    </Link>
                  ) : (
                    <span key={category.id}>{category.name}</span>
                  ),
                )}
              </nav>
            )}
            <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
            {product.sku && <p className="text-xs text-muted-foreground">Ref. {product.sku}</p>}
          </header>
          {product.shortDescription && (
            <div className="wp-content text-sm text-muted-foreground" dangerouslySetInnerHTML={{ __html: product.shortDescription }} />
          )}
          <ProductPurchase product={product} variations={variations} />
        </div>
      </div>

      {product.description && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Descrição</h2>
          <div className="wp-content" dangerouslySetInnerHTML={{ __html: product.description }} />
        </section>
      )}

      {product.tags.length > 0 && (
        <section className="flex flex-wrap gap-2 text-sm">
          {product.tags.map((tag) =>
            tag.path ? (
              <Link key={tag.id} href={tag.path} className="rounded-full border px-3 py-1 hover:bg-muted">
                #{tag.name}
              </Link>
            ) : null,
          )}
        </section>
      )}

      <HeadpressProductReviews
        productId={product.id}
        action={
          reviewPath ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={reviewPath}>Avaliar este produto</Link>
            </Button>
          ) : undefined
        }
      />
    </article>
  );
}
