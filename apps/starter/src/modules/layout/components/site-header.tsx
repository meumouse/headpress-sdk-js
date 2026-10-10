"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Search, ShoppingBag, User } from "lucide-react";

import { useCapability, useCart, useHeadpress, useHeadpressValue, useStoreConfig } from "@meumouse/headpress/react";

import { HeadpressSearchDialog } from "@/components/headpress-search-dialog";
import { Button } from "@/components/ui/button";

/** Items in the cart. Mounted only when the shopper already has a cart, so guests never open one. */
function CartCount() {
  const [state] = useCart();
  const count = state.cart?.itemsCount ?? 0;
  if (!count) return null;
  return (
    <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
      {count}
    </span>
  );
}

export function SiteHeader() {
  const router = useRouter();
  const hp = useHeadpress();
  const config = useStoreConfig();
  const search = useCapability("search");
  const [searchOpen, setSearchOpen] = useState(false);
  // Every link comes from the store's route map; a route the store turned off is not linked.
  const links = useHeadpressValue(
    (hp) => ({
      home: hp.routes.path("home") ?? "/",
      shop: hp.routes.path("shop"),
      cart: hp.routes.path("cart"),
      account: hp.routes.path("account"),
    }),
    [config?.version],
  );

  // A cart exists once the hp_cart cookie does, or as soon as any widget on the page loads one.
  const hasCart = useSyncExternalStore(
    useCallback((listener: () => void) => hp.cart.subscribe(listener), [hp]),
    () => hp.cart.peek() !== null || document.cookie.split(";").some((part) => part.trim().startsWith("hp_cart=")),
    () => false,
  );

  // ⌘K / Ctrl+K opens the search.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link href={links.home} className="font-semibold tracking-tight">
          {config?.store.name || "Headpress Starter"}
        </Link>
        <nav className="flex flex-1 items-center gap-4 text-sm text-muted-foreground">
          {links.shop && (
            <Link href={links.shop} className="hover:text-foreground">
              Loja
            </Link>
          )}
        </nav>
        {search && (
          <Button variant="ghost" size="icon" aria-label="Buscar" onClick={() => setSearchOpen(true)}>
            <Search />
          </Button>
        )}
        {links.account && (
          <Button variant="ghost" size="icon" asChild>
            <Link href={links.account} aria-label="Minha conta">
              <User />
            </Link>
          </Button>
        )}
        {links.cart && (
          <Button variant="ghost" size="icon" className="relative" asChild>
            <Link href={links.cart} aria-label="Carrinho">
              <ShoppingBag />
              {hasCart && <CartCount />}
            </Link>
          </Button>
        )}
      </div>
      {search && (
        <HeadpressSearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          onNavigate={(path) => (/^https?:\/\//i.test(path) ? window.location.assign(path) : router.push(path))}
          resultsPath={links.shop ? (query) => `${links.shop}?q=${encodeURIComponent(query)}` : undefined}
        />
      )}
    </header>
  );
}
