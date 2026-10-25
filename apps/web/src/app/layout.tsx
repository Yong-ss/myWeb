import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
    title: "SquirrelAPI · 小工具，大可能",
    description: "一个慢慢生长的工具空间，把实用的小想法变成触手可及的应用。",
    robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{
    children: React.ReactNode;
}>) {
    return <html lang="zh-CN"><body>{children}</body></html>;
}
