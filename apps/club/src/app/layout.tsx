import type { Metadata } from "next";
import "./globals.css";
import {ClubFrame} from "../components/layout/ClubFrame";

export const metadata: Metadata = {
  title: "Club · SquirrelAPI",
  description: "俱乐部管理空间",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><a className="skip-link" href="#content">跳到主要内容</a><div id="content"><ClubFrame>{children}</ClubFrame></div></body></html>;
}
