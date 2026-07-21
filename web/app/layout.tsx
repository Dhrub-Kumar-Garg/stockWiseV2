import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dhrub Garg · StockWise v2",
  description:
    "StockWise v2 — an honest paper-trading bot that uses real prices with fake money.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,100..900;1,9..144,100..900&family=M+PLUS+Rounded+1c:wght@300;400;500;700;800&family=Zen+Maru+Gothic:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body suppressHydrationWarning>
        {/* Warm gradient sky + glowing sun — behind everything */}
        <div className="sky" />
        <div className="sun" />
        {children}
      </body>
    </html>
  );
}
