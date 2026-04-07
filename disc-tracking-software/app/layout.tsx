// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { DeviceProvider } from "@/contexts/DeviceContext";

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
          <DeviceProvider>
            {children}
            <Toaster richColors position="top-center" />
          </DeviceProvider>
        </SettingsProvider>
      </body>
    </html>
  );
}