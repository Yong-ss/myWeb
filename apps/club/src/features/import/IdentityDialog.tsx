"use client";
import { useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Checkbox } from "../../components/ui/checkbox";
import { Field, FieldLabel } from "../../components/ui/field";
import { Dialog, DialogContent, DialogTitle } from "../../components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { Reveal } from "../../components/ui/motion";
import { fields, numericFields, type Member, type Player } from "../../domain/member";
import type { Match } from "./identity";
import { labels, fieldValue, invalidCorrection, type Row } from "./workflow";

export type IdentityChoice = { identity: string; remember: boolean; correction?: { name: string; expected: string } };
type Props = {
  index: number | null; rows: Row[]; matches: Match[]; players: Player[]; pending: number;
  onClose: () => void; onConfirm: (index: number, choice: IdentityChoice) => void;
  onEdit: (index: number, member: Member) => void; onRemove: (index: number) => void;
};

/** Confirms one imported row's identity. Draft choices stay local until confirmed; the page owns the rows. */
export function IdentityDialog(props: Props) {
  // Keep showing the last row while the dialog animates closed, instead of emptying it mid-exit.
  const [shown, setShown] = useState(props.index);
  if (props.index !== null && props.index !== shown) setShown(props.index);
  const index = props.index ?? shown;
  const row = index === null ? null : props.rows[index];
  return <Dialog open={props.index !== null} onOpenChange={open => { if (!open) props.onClose(); }}>
    <DialogContent aria-describedby={undefined} className="identity-dialog w-[min(32.5rem,calc(100vw-2rem))]">
      {/* Keyed by row: moving to the next player starts a fresh draft, which slides in to show the change. */}
      {row && index !== null && <Reveal kind="step" key={index} className="flex flex-col gap-4">
        <Draft {...props} index={index} row={row} />
      </Reveal>}
    </DialogContent>
  </Dialog>;
}

function Draft({ index, row, rows, matches, players, pending, onClose, onConfirm, onEdit, onRemove }: Omit<Props, "index"> & { index: number; row: Row }) {
  const [mode, setMode] = useState<"start" | "existing">(row.identity && row.identity !== "new" ? "existing" : "start");
  const [choice, setChoice] = useState(row.identity);
  const [search, setSearch] = useState("");
  const [remember, setRemember] = useState(row.remember);
  const [correct, setCorrect] = useState<string | null>(row.correction?.name ?? null);
  const id = useId();
  const match = matches[index];
  const player = players.find(p => p.id === choice);
  const recommended = new Set(match?.candidates.map(p => p.id) ?? []);
  const options = [...(match?.candidates ?? []).flatMap(candidate => players.filter(p => p.id === candidate.id)), ...players.filter(p => !recommended.has(p.id))].filter(p => !search || p.display_name.includes(search));
  function confirm() {
    if (!choice) return;
    onConfirm(index, { identity: choice, remember: remember && choice !== "new", correction: correct !== null && player ? { name: correct.trim(), expected: player.display_name } : undefined });
  }
  return <>
    <div className="flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">{pending ? `还剩 ${pending} 人` : "修改选择"}</span><Button variant="ghost" size="icon" className="text-2xl" aria-label="关闭玩家确认" onClick={onClose}>×</Button></div>
    <p className="ornate m-0 rounded-sm border border-border p-4"><span className="eyebrow block">本次识别</span><strong className="mt-1.5 block font-heading text-2xl font-medium text-gold [overflow-wrap:anywhere]">{row.member.name ?? "昵称没看清"}</strong></p>
    <DialogTitle>这是新玩家，还是已有玩家？</DialogTitle>
    <div className="grid grid-cols-2 gap-3"><Button variant="secondary" className="min-h-16" aria-pressed={choice === "new"} disabled={!row.member.name} onClick={() => { setMode("start"); setChoice("new"); setRemember(false); setCorrect(null); }}>新增玩家</Button><Button variant="secondary" className="min-h-16" aria-pressed={mode === "existing"} onClick={() => { setMode("existing"); setChoice(""); setRemember(false); setCorrect(null); }}>选择已有玩家</Button></div>
    {choice === "new" && <Field><FieldLabel htmlFor={`${id}-new`}>新玩家昵称</FieldLabel><Input id={`${id}-new`} value={row.member.name ?? ""} onChange={e => onEdit(index, { ...row.member, name: e.target.value || null })} /></Field>}
    {mode === "existing" && <div className="flex flex-col gap-3">
      <Field><FieldLabel htmlFor={`${id}-search`}>已有玩家</FieldLabel><Input id={`${id}-search`} value={search} placeholder="搜索名字（可选）" onChange={e => setSearch(e.target.value)} /></Field>
      <div className="identity-picker-list grid max-h-60 gap-2 overflow-y-auto overscroll-contain">{options.map(p => { const used = rows.some((r,i) => i !== index && r.identity === p.id); return <Button key={p.id} variant="secondary" className="shrink-0 justify-between text-left" disabled={used} aria-pressed={choice === p.id} onClick={() => { setChoice(p.id); setRemember(false); setCorrect(null); }}><strong className="font-medium">{p.display_name}{players.filter(other => other.display_name === p.display_name).length > 1 && <small className="text-muted-foreground">（{p.id.slice(-8)}）</small>}</strong><span className="text-xs text-muted-foreground">{used ? "本次已选" : choice === p.id ? "✓" : recommended.has(p.id) ? "推荐" : ""}</span></Button>; })}</div>
      {search && !players.some(p => p.display_name.includes(search)) && <p className="m-0 text-sm text-muted-foreground">没找到这个名字。</p>}
      {player && <div className="nickname-correction flex flex-col gap-3 rounded-sm border border-border p-4"><p className="m-0 flex flex-wrap items-center gap-2 text-sm">对应玩家：<strong className="text-gold">{player.display_name}</strong> <Button variant="ghost" size="compact" onClick={()=>setCorrect(correct===null?player.display_name:null)}>{correct===null?"更正昵称":"取消更正"}</Button></p>{correct!==null&&<><Field><FieldLabel htmlFor={`${id}-correct`}>正确昵称</FieldLabel><Input id={`${id}-correct`} maxLength={200} value={correct} onChange={e=>setCorrect(e.target.value)}/></Field><Button variant="ghost" size="compact" className="self-start" disabled={!row.sourceName} onClick={()=>setCorrect(row.sourceName??"")}>使用本次识别的名字</Button><p className="m-0 text-sm text-muted-foreground">随最终导入一起保存，历史记录保留。</p></>}</div>}
      {player && row.sourceName && row.sourceName.trim() !== (correct?.trim()||player.display_name.trim()) && <Field orientation="horizontal" className="rounded-sm border border-border bg-card p-3"><Checkbox id={`${id}-remember`} checked={remember} onCheckedChange={v => setRemember(v === true)} /><FieldLabel htmlFor={`${id}-remember`}>记住这个AI错名，下次自动匹配到「{correct?.trim()||player.display_name}」</FieldLabel></Field>}
    </div>}
    <Collapsible className="identity-extra">
      <CollapsibleTrigger>修改识别数据</CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4 pt-3"><div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">{fields.map(k => <Field key={k}><FieldLabel htmlFor={`${id}-${k}`}>{labels[k]}</FieldLabel><Input id={`${id}-${k}`} value={row.member[k] ?? ""} placeholder="未识别" inputMode={(numericFields as readonly string[]).includes(k) ? "numeric" : "text"} onChange={e => onEdit(index, { ...row.member, [k]: fieldValue(k, e.target.value) })} /></Field>)}</div><Button variant="ghost" size="compact" className="self-start text-destructive" onClick={() => onRemove(index)}>移除重复记录</Button></CollapsibleContent>
    </Collapsible>
    <div className="flex items-center justify-between gap-3 border-t border-divider pt-4"><Button variant="ghost" onClick={onClose}>稍后处理</Button><Button disabled={!choice||invalidCorrection(correct)} onClick={confirm}>{pending > 1 ? "确认，下一位 →" : "确认"}</Button></div>
  </>;
}
