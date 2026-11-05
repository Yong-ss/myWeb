import type { Metadata } from "next";
import "./globals.css";
import {ClubFrame} from "../components/layout/ClubFrame";
import {themeBootScript} from "../lib/theme";

export const metadata: Metadata = {
  title: "Club · SquirrelAPI",
  description: "俱乐部管理空间",
  robots: { index: false, follow: false },
};

// The boot script sets data-theme on <html> before hydration, hence suppressHydrationWarning (on <html> only).
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html: themeBootScript}} /></head><body><a className="skip-link" href="#content">跳到主要内容</a><div id="content"><ClubFrame>{children}</ClubFrame></div></body></html>;
}
