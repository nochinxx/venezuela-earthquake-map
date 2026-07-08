import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://sismovenezuela.com"),
  title: "SismoVenezuela — Daños en tiempo real",
  description: "Mapa en tiempo real de los sismos en Venezuela (24 Jun 2026, M7.2 + M7.5). Reportes de YouTube, X/Twitter e Instagram. Desaparecidos, centros de acopio y números de emergencia.",
  openGraph: {
    title: "SismoVenezuela — Daños en tiempo real",
    description: "Doblete sísmico M7.2 + M7.5 · 24 Jun 2026 · Reportes en tiempo real de YouTube, X e Instagram",
    siteName: "SismoVenezuela",
    locale: "es_VE",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SismoVenezuela — Daños en tiempo real",
    description: "Doblete sísmico M7.2 + M7.5 · 24 Jun 2026 · Reportes en tiempo real",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
