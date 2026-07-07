import type { Metadata } from "next";
import { headers } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Layout";
import { MobileBookBar } from "@/components/layout/MobileBookBar";
import { FooterSwitcher } from "@/components/layout/FooterSwitcher";
import {
  getSiteSettings,
  normalizeTwitterHandle,
} from "@/app/services/site-settings-service";
import { SITE_URL } from "@/app/lib/site-url";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  const twitterHandle = normalizeTwitterHandle(settings.twitterHandle);

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: "Harbour Hair Salon | Expert Hair Styling in Leeds",
      template: "%s | Harbour Hair Salon Leeds",
    },
    description:
      "Professional hair salon in Leeds city centre. Expert cuts, colours, perms and treatments by Hong Kong trained stylists. Book online at Central Arcade, LS1 6DX.",
    icons: {
      icon: [
        { url: "/images/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/images/favicon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: [{ url: "/images/favicon-192.png", sizes: "192x192" }],
    },
    manifest: "/site.webmanifest",
    openGraph: {
      type: "website",
      locale: "en_GB",
      siteName: "Harbour Hair Salon",
      title: "Harbour Hair Salon | Expert Hair Styling in Leeds",
      description:
        "Professional hair salon in Leeds city centre. Expert cuts, colours, and treatments by Hong Kong trained stylists.",
      images: [
        {
          url: "/images/og-image.png",
          width: 1200,
          height: 630,
          alt: "Harbour Hair Salon - Expert Hair Styling in Leeds",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Harbour Hair Salon | Expert Hair Styling in Leeds",
      description:
        "Professional hair salon in Leeds city centre. Book online today.",
      images: ["/images/og-image.png"],
      ...(twitterHandle ? { site: twitterHandle, creator: twitterHandle } : {}),
    },
    alternates: { canonical: "/" },
    ...(settings.gscVerification
      ? { verification: { google: settings.gscVerification } }
      : {}),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Admin and kiosk render their own full-screen shells, so they don't need the
  // marketing header/footer/book bar — or the extra DB queries those fire.
  // src/middleware.ts sets x-pathname on matched routes; on unmatched routes the
  // header is whatever the client sent (i.e. spoofable), so it must only ever
  // gate cosmetic chrome like this, never security decisions.
  const pathname = (await headers()).get("x-pathname") ?? "";
  const bareShell =
    pathname.startsWith("/admin") || pathname.startsWith("/kiosk");

  return (
    // data-scroll-behavior lets the Next router suspend smooth scrolling while
    // it resets scroll position on navigation — without it, route changes
    // animate from the old scroll offset instead of landing at the top.
    <html lang="en-GB" className="scroll-smooth" data-scroll-behavior="smooth">
      <body className="antialiased bg-zinc-50 text-zinc-900 font-sans">
        {!bareShell && <Header />}
        <main className="min-h-screen">
          {children}
        </main>
        {!bareShell && (
          <FooterSwitcher
            marketing={
              <>
                <Footer />
                <MobileBookBar />
              </>
            }
          />
        )}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
