import Link from "next/link";

import { hp } from "@/lib/headpress";
import { getStoreConfig } from "@/lib/headpress-server";
import { ProductGrid } from "@/modules/products/components/product-card";

// Rebuilt when the revalidation webhook expires `product:list` (or every 5 minutes, see nextCache()).
export const revalidate = 300;

export default async function HomePage() {
  // The route map must be loaded before products are normalized: `product.path` comes from it.
  const config = await getStoreConfig();
  const page = await hp.catalog.list({ perPage: 12, orderby: "date", order: "desc" });
  const shop = hp.routes.path("shop");

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{config?.store.name || "Headpress Starter"}</h1>
        {config?.store.description && <p className="text-muted-foreground">{config.store.description}</p>}
      </section>
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Novidades</h2>
          {shop && (
            <Link href={shop} className="text-sm underline underline-offset-4">
              Ver todos
            </Link>
          )}
        </div>
        <ProductGrid products={page.items} />
      </section>
    </div>
  );
}
