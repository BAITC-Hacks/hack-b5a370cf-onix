import type { Metadata } from "next";
import Report from "@/components/Report";

export const metadata: Metadata = { title: "Отчёт о решении — Аким на 5 часов" };

export default function ReportPage() {
  return <Report />;
}
