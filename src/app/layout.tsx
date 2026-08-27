import type { Metadata } from "next";
import { Montserrat, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { auth } from "@/auth";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SDSL — SIM",
  description: "Professional stock and asset management system for STRAIGHT DRIVE",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${montserrat.variable} ${geistMono.variable} min-h-screen font-sans antialiased`}
      >
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  );
}
