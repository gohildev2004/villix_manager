import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.RENDER_EXTERNAL_URL ?? "http://localhost:3000"),
  title: { default: "Villix Manager", template: "%s · Villix Manager" },
  description: "Auditable contribution, commission, and weekly payout operations for Villix administrators.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/villix-logo.svg" },
  openGraph: {
    title: "Villix Manager",
    description: "Contribution in. Payout clarity out.",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "Villix Manager payout operations" }],
  },
  twitter: { card: "summary_large_image", title: "Villix Manager", description: "Contribution in. Payout clarity out.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
