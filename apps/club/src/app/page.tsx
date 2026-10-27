import Link from "next/link";

export default function Home() {
  return <main className="shell"><p className="brand">SquirrelAPI / Club</p><h1>你的俱乐部空间。</h1><p>每日 JSON 导入与人工核对已开放，历史查询仍在准备中。</p><Link className="button" href="/account">进入俱乐部</Link><p><a href="https://squirrelapi.org">返回 SquirrelAPI</a></p></main>;
}
