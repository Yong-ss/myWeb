import { ButtonLink } from "../components/ui/button";
import { Card, CardDescription, CardTitle } from "../components/ui/card";

const steps = [["01", "带回识别结果", "把游戏截图交给 AI，导入 JSON。"], ["02", "核对玩家身份", "自动匹配熟悉的玩家，只确认不确定的人。"], ["03", "保存每日档案", "修正保留旧版，历史随时查阅。"]];

export default function Home() {
  return <main className="club-workspace club-landing max-w-280 pt-12">
    <p className="eyebrow">THE CLUB ARCHIVES / 俱乐部档案</p>
    <h1 className="gold-title mt-6 mb-4 text-[clamp(2rem,6vw,4rem)] leading-tight">留住俱乐部的<br />每一天。</h1>
    <p className="m-0 max-w-170 text-lg text-muted-foreground">记录成员，核对变化，查阅过往。</p>
    <div className="mt-8 flex flex-wrap items-center gap-6">
      <ButtonLink href="/account">进入俱乐部 →</ButtonLink>
      <a className="club-return py-3 text-sm text-muted-foreground hover:text-gold" href="https://squirrelapi.org">返回 SquirrelAPI</a>
    </div>
    <div className="club-home-features mt-12 grid grid-cols-3 gap-6 max-md:grid-cols-1 max-md:gap-4">
      {steps.map(([number, title, description], i) => <Card key={number} ornate={i === 0} className="gap-3 p-8 max-md:p-6">
        <span className="eyebrow">{number}</span>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="leading-loose">{description}</CardDescription>
      </Card>)}
    </div>
  </main>;
}
