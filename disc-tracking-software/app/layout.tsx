// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { SettingsProvider } from "@/contexts/SettingsContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Disc Tracking Software",
  description: "Track your disc golf throws and improve your game",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <SettingsProvider>  {/* ← wrap entire app */}
          {children}
          <Toaster richColors position="top-center" />
        </SettingsProvider>
      </body>
    </html>
  );
}