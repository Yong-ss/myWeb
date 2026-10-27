import Link from "next/link";

export default function NotFound() {
  return <main className="shell"><h1>页面不存在</h1><Link href="/">返回 Club 首页</Link></main>;
}
