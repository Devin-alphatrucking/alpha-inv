import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { getBrand } from "@/lib/brand/brand";
import { brandCss } from "@/lib/brand/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const full = brand.isDefault ? brand.name : `${brand.name} · Invoice & Billing`;
  return {
    title: {
      default: full,
      template: `%s | ${brand.shortName}`,
    },
    description: "Purchase invoice and payment management",
    applicationName: brand.name,
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
        { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      shortcut: "/favicon.ico",
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    appleWebApp: {
      capable: true,
      title: brand.shortName,
      statusBarStyle: "default",
    },
    formatDetection: { telephone: false },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const brand = await getBrand();
  // Only strict #RRGGBB colours can ever reach this (see lib/brand/theme.ts).
  const themeCss = brandCss({ primary: brand.primaryColor, accent: brand.accentColor });
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {themeCss ? <style id="brand-theme" dangerouslySetInnerHTML={{ __html: themeCss }} /> : null}
      </head>
      <body
        suppressHydrationWarning
        className="flex min-h-full flex-col font-sans antialiased"
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
