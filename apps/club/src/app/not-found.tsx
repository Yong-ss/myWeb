import { ButtonLink } from "../components/ui/Button";
import { Panel } from "../components/ui/Panel";

export default function NotFound() {
  return <main className="club-workspace club-login"><Panel><p className="eyebrow">404 · 走错了一小步</p><h1>这里还没有页面。</h1><p>链接可能已更改，你可以回到工作台继续操作。</p><ButtonLink href="/account">回到工作台</ButtonLink></Panel></main>;
}
