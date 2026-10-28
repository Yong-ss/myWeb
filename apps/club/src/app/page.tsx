import { ButtonLink } from "../components/ui/Button";
import { Panel } from "../components/ui/Panel";
export default function Home() {
  return <><main className="club-workspace club-landing"><p className="eyebrow">THE CLUB ARCHIVES / 俱乐部档案</p><h1>留住俱乐部的<br />每一天。</h1><p className="lede">记录成员，核对变化，查阅过往。</p><div className="actions"><ButtonLink href="/account">进入俱乐部 →</ButtonLink><a className="club-return" href="https://squirrelapi.org">返回 SquirrelAPI</a></div><div className="club-account-actions club-home-features">{[["01", "带回识别结果", "把游戏截图交给 AI，导入 JSON。"], ["02", "核对玩家身份", "自动匹配熟悉的玩家，只确认不确定的人。"], ["03", "保存每日档案", "修正保留旧版，历史随时查阅。"]].map(([number,title,description])=><Panel key={number}><span className="club-task-index">{number}</span><h2>{title}</h2><p>{description}</p></Panel>)}</div></main></>;
}
