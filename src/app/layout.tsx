import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "LeadLens", template: "%s · LeadLens" },
  description: "Where are we spending money and staff time, and which lead sources actually create revenue?",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#0d1b36", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} style={{ ["--font-sans" as string]: "var(--font-inter), ui-sans-serif, system-ui, sans-serif" }}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
