import type { Metadata } from "next";
import { AppStateProvider } from "@/components/AppState";
import { Shell } from "@/components/Shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Аким на 5 часов — AI-симулятор управления городом",
  description: "Распределите бюджет Астаны на 5 решений и получите Astana Quality of Life Score с AI-объяснением и агентом-советником.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full">
        <AppStateProvider>
          <Shell>{children}</Shell>
        </AppStateProvider>
      </body>
    </html>
  );
}
