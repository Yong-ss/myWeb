"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Fields";
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
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (props.index !== null) dialog.current?.showModal(); else dialog.current?.close(); }, [props.index]);
  const row = props.index === null ? null : props.rows[props.index];
  // Keyed by row so opening another row starts a fresh draft from that row.
  return <dialog ref={dialog} onCancel={props.onClose} aria-labelledby="identity-title" className="panel identity-dialog">{row && <Draft key={props.index} {...props} index={props.index!} row={row} />}</dialog>;
}

function Draft({ index, row, rows, matches, players, pending, onClose, onConfirm, onEdit, onRemove }: Omit<Props, "index"> & { index: number; row: Row }) {
  const [mode, setMode] = useState<"start" | "existing">(row.identity && row.identity !== "new" ? "existing" : "start");
  const [choice, setChoice] = useState(row.identity);
  const [search, setSearch] = useState("");
  const [remember, setRemember] = useState(row.remember);
  const [correct, setCorrect] = useState<string | null>(row.correction?.name ?? null);
  const match = matches[index];
  const player = players.find(p => p.id === choice);
  const recommended = new Set(match?.candidates.map(p => p.id) ?? []);
  const options = [...(match?.candidates ?? []).flatMap(candidate => players.filter(p => p.id === candidate.id)), ...players.filter(p => !recommended.has(p.id))].filter(p => !search || p.display_name.includes(search));
  function confirm() {
    if (!choice) return;
    onConfirm(index, { identity: choice, remember: remember && choice !== "new", correction: correct !== null && player ? { name: correct.trim(), expected: player.display_name } : undefined });
  }
  return <>
    <div className="identity-dialog-top"><span className="muted">{pending ? `还剩 ${pending} 人` : "修改选择"}</span><Button className="text-button" aria-label="关闭玩家确认" onClick={onClose}>×</Button></div>
    <p className="identity-source"><span>本次识别</span><strong>{row.member.name ?? "昵称没看清"}</strong></p>
    <h2 id="identity-title">这是新玩家，还是已有玩家？</h2>
    <div className="identity-type"><Button aria-pressed={choice === "new"} disabled={!row.member.name} onClick={() => { setMode("start"); setChoice("new"); setRemember(false); setCorrect(null); }}>新增玩家</Button><Button aria-pressed={mode === "existing"} onClick={() => { setMode("existing"); setChoice(""); setRemember(false); setCorrect(null); }}>选择已有玩家</Button></div>
    {choice === "new" && <label className="identity-new-name">新玩家昵称<Input value={row.member.name ?? ""} onChange={e => onEdit(index, { ...row.member, name: e.target.value || null })} /></label>}
    {mode === "existing" && <div className="identity-picker"><label htmlFor="identity-search">已有玩家</label><Input id="identity-search" value={search} placeholder="搜索名字（可选）" onChange={e => setSearch(e.target.value)} />
      <div className="identity-picker-list">{options.map(p => { const used = rows.some((r,i) => i !== index && r.identity === p.id); return <Button key={p.id} disabled={used} aria-pressed={choice === p.id} onClick={() => { setChoice(p.id); setRemember(false); setCorrect(null); }}><strong>{p.display_name}{players.filter(other => other.display_name === p.display_name).length > 1 && <small>（{p.id.slice(-8)}）</small>}</strong><span>{used ? "本次已选" : choice === p.id ? "✓" : recommended.has(p.id) ? "推荐" : ""}</span></Button>; })}</div>
      {search && !players.some(p => p.display_name.includes(search)) && <p className="muted">没找到这个名字。</p>}
      {player && <div className="nickname-correction"><p>对应玩家：<strong>{player.display_name}</strong> <Button className="text-button" onClick={()=>setCorrect(correct===null?player.display_name:null)}>{correct===null?"更正昵称":"取消更正"}</Button></p>{correct!==null&&<><label>正确昵称<Input maxLength={200} value={correct} onChange={e=>setCorrect(e.target.value)}/></label><Button className="text-button" disabled={!row.sourceName} onClick={()=>setCorrect(row.sourceName??"")}>使用本次识别的名字</Button><p className="muted">随最终导入一起保存，历史记录保留。</p></>}</div>}
      {player && row.sourceName && row.sourceName.trim() !== (correct?.trim()||player.display_name.trim()) && <label className="check"><Input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />记住这个AI错名，下次自动匹配到「{correct?.trim()||player.display_name}」</label>}
    </div>}
    <details className="identity-extra"><summary>修改识别数据</summary><div className="identity-fields">{fields.map(k => <label key={k}>{labels[k]}<Input value={row.member[k] ?? ""} placeholder="未识别" inputMode={(numericFields as readonly string[]).includes(k) ? "numeric" : "text"} onChange={e => onEdit(index, { ...row.member, [k]: fieldValue(k, e.target.value) })} /></label>)}</div><Button className="text-button danger" onClick={() => onRemove(index)}>移除重复记录</Button></details>
    <div className="identity-dialog-footer"><Button className="text-button" onClick={onClose}>稍后处理</Button><Button className="button" disabled={!choice||invalidCorrection(correct)} onClick={confirm}>{pending > 1 ? "确认，下一位 →" : "确认"}</Button></div>
  </>;
}
