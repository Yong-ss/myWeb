import Link from "next/link";

export default function Home() {
  return <main className="shell"><p className="brand">SquirrelAPI / Club</p><h1>你的俱乐部空间。</h1><p>目前已开放账户登录，数据导入与历史查询正在准备中。</p><Link className="button" href="/account">进入俱乐部</Link><p><a href="https://squirrelapi.org">返回 SquirrelAPI</a></p></main>;
}
