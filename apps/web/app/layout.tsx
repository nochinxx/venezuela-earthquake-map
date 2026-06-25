import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  metadataBase: new URL("https://venezuela-earthquake-map.vercel.app"),
  title: "Venezuela Earthquake Map — Daños en tiempo real",
  description: "Mapa en tiempo real de daños del terremoto en Venezuela (24 Jun 2026). Reportes de YouTube, X/Twitter e Instagram. Centros de acopio y números de emergencia.",
  openGraph: {
    title: "Venezuela Earthquake Map — Daños en tiempo real",
    description: "Terremoto M7.2 · 24 Jun 2026 · Reportes en tiempo real de YouTube, X e Instagram",
    siteName: "Venezuela Earthquake Map",
    locale: "es_VE",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Venezuela Earthquake Map — Daños en tiempo real",
    description: "Terremoto M7.2 · 24 Jun 2026 · Reportes en tiempo real",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
