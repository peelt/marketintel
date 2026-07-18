import type { Metadata } from "next";
import { Ubuntu, Ubuntu_Mono } from "next/font/google";
import "./globals.css";

// Family type pairing: Ubuntu for prose, Ubuntu Mono for anything "machine".
const ubuntu = Ubuntu({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-ubuntu",
  weight: ["300", "400", "500", "700"],
  preload: true,
});
const ubuntuMono = Ubuntu_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-ubuntu-mono",
  weight: ["400", "700"],
  preload: true,
});

export const metadata: Metadata = {
  title: "Investorlogical",
  description:
    "Glass-box investment research: scheduled specialist desks file ranked, evidence-backed reports against scoring frameworks you can see in full — every score traceable to the sources behind it.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${ubuntu.variable} ${ubuntuMono.variable}`}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
