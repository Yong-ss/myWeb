import Link from "next/link";

export default function Home() {
  return <main className="shell landing"><p className="eyebrow">每天几分钟，留住俱乐部的变化</p><h1>今天的俱乐部，<br />也值得好好记录。</h1><p className="lede">上传截图给 AI，把识别结果带回来。熟悉的玩家会自动匹配，你只需看看需要确认的地方。</p><div className="actions"><Link className="button" href="/account">进入俱乐部 →</Link><a href="https://squirrelapi.org">返回 SquirrelAPI</a></div><div className="feature-grid"><article className="panel"><span className="step-number">01</span><h2>带回识别结果</h2><p>复制识别说明，交给你常用的 AI，再上传或粘贴 JSON。</p></article><article className="panel"><span className="step-number">02</span><h2>只关注需要确认的玩家</h2><p>准确昵称和确认别名自动匹配，不确定的地方由你决定。</p></article><article className="panel"><span className="step-number">03</span><h2>安心保存每一天</h2><p>修正数据会保留旧版本，重复点击也不会多存一份。</p></article></div></main>;
}
