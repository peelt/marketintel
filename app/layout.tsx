import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "marketintel",
  description: "Investment research agents",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
