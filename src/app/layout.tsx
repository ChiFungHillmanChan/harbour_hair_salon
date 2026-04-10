import type { Metadata } from "next";
import { Inter, Cormorant_Garamond } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Layout";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-cormorant",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://harbourhairsalon.co.uk"),
  title: {
    default: "Harbour Hair Salon | Expert Hair Styling in Leeds",
    template: "%s | Harbour Hair Salon Leeds",
  },
  description:
    "Professional hair salon in Leeds city centre. Expert cuts, colours, perms and treatments by Hong Kong trained stylists. Book online at Central Arcade, LS1 6DX.",
  icons: {
    icon: [
      { url: "/images/favicon.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [
      { url: "/images/favicon.png", sizes: "180x180" },
    ],
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
  },
  alternates: {
    canonical: "/",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GB" className={`${inter.variable} ${cormorant.variable} scroll-smooth`}>
      <body className="antialiased bg-zinc-50 text-zinc-900 font-sans">
        <Header />
        <main className="min-h-screen">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
