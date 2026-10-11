import type { Metadata } from "next";

import { getStoreConfig } from "@/lib/headpress-server";
import { CookieBanner } from "@/modules/layout/components/cookie-banner";
import { Providers } from "@/modules/layout/components/providers";
import { SiteHeader } from "@/modules/layout/components/site-header";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const config = await getStoreConfig();
  const name = config?.store.name || "Headpress Starter";
  return {
    title: { default: name, template: `%s · ${name}` },
    description: config?.store.description || undefined,
    ...(process.env.NEXT_PUBLIC_SITE_URL ? { metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL) } : {}),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const config = await getStoreConfig();
  return (
    <html lang={config?.store.language || "pt-BR"}>
      <body className="min-h-screen antialiased">
        <Providers config={config}>
          <SiteHeader />
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          <footer className="border-t py-6 text-center text-xs text-muted-foreground">
            Built with @meumouse.com/headpress
          </footer>
          <CookieBanner />
        </Providers>
      </body>
    </html>
  );
}
