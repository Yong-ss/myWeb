import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Club · SquirrelAPI",
  description: "俱乐部管理空间",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
