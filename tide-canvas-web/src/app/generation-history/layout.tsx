import "@/styles/liuguang/admin.css";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./generation-history.css";

export default function GenerationHistoryLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`admin-body user-history-body ${GeistSans.variable} ${GeistMono.variable}`}>
      {children}
    </div>
  );
}
