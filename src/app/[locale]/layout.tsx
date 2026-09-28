import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "../globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Layout";
import { MobileBookBar } from "@/components/layout/MobileBookBar";
import { FooterSwitcher } from "@/components/layout/FooterSwitcher";
import {
  getSiteSettings,
  normalizeTwitterHandle,
} from "@/app/services/site-settings-service";
import { SITE_URL } from "@/app/lib/site-url";
import { HTML_LANG, LOCALE_SEGMENT, LOCALES, OG_LOCALE, localeFromSegment } from "@/i18n/config";
import { I18nProvider } from "@/i18n/client";
import { pickSections, translator } from "@/i18n/messages";
import { alternatesFor } from "@/i18n/metadata";

/** Both languages are prerendered; an unknown segment never reaches here (middleware). */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale: LOCALE_SEGMENT[locale] }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const locale = localeFromSegment((await params).locale) ?? "en-GB";
  const t = translator(locale, "common");
  const settings = await getSiteSettings();
  const twitterHandle = normalizeTwitterHandle(settings.twitterHandle);

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: t("meta.defaultTitle"),
      template: t("meta.titleTemplate"),
    },
    description: t("meta.description"),
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
      locale: OG_LOCALE[locale],
      alternateLocale: LOCALES.filter((other) => other !== locale).map((other) => OG_LOCALE[other]),
      siteName: t("meta.siteName"),
      title: t("meta.defaultTitle"),
      description: t("meta.ogDescription"),
      images: [
        {
          url: "/images/og-image.png",
          width: 1200,
          height: 630,
          alt: t("meta.ogImageAlt"),
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: t("meta.defaultTitle"),
      description: t("meta.twitterDescription"),
      images: ["/images/og-image.png"],
      ...(twitterHandle ? { site: twitterHandle, creator: twitterHandle } : {}),
    },
    alternates: alternatesFor(locale, "/"),
    ...(settings.gscVerification
      ? { verification: { google: settings.gscVerification } }
      : {}),
  };
}

export default async function RootLayout({ children, params }: LayoutProps<"/[locale]">) {
  const locale = localeFromSegment((await params).locale);
  if (!locale) notFound();

  return (
    // data-scroll-behavior lets the Next router suspend smooth scrolling while
    // it resets scroll position on navigation — without it, route changes
    // animate from the old scroll offset instead of landing at the top.
    <html lang={HTML_LANG[locale]} className="scroll-smooth" data-scroll-behavior="smooth">
      <body className="antialiased bg-zinc-50 text-zinc-900 font-sans">
        {/* Only the strings client components use ship with every page (the
            footer and metadata copy is rendered on the server); each page adds
            the namespaces its own client components need. */}
        <I18nProvider locale={locale} messages={pickSections(locale, "common", ["language", "nav", "actions", "states", "errors", "pagination", "contentFallback"])}>
          <Header />
          <main className="min-h-screen">
            {children}
          </main>
          <FooterSwitcher
            footer={<Footer />}
            mobileBookBar={<MobileBookBar />}
          />
        </I18nProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
