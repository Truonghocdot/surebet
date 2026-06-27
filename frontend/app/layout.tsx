import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Surebet Control Tower",
  description: "Realtime architecture scaffold for surebet operations"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

