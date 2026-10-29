import { ButtonLink } from "../components/ui/button";
import { Card, CardDescription } from "../components/ui/card";

export default function NotFound() {
  return <main className="club-workspace max-w-128 pt-12">
    <Card ornate className="gap-3 p-8 max-md:p-6">
      <p className="eyebrow">404 · 走错了一小步</p>
      <h1 className="gold-title m-0 text-title">这里还没有页面。</h1>
      <CardDescription>链接可能已更改，你可以回到工作台继续操作。</CardDescription>
      <ButtonLink href="/account" className="mt-2">回到工作台</ButtonLink>
    </Card>
  </main>;
}
