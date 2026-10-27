"use client";
import Link from "next/link";
import { AppShell } from "../../components/layout/AppShell";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button } from "../../components/ui/Button";
import { Input, Select, Textarea } from "../../components/ui/Fields";
import { useEffect, useRef, useState } from "react";
import { fields, numericFields, parseSource, validateRows, mergePreview, validDate, MAX_SOURCE_BYTES, type Member, type ImportContext, type ConfirmedMember } from "../../lib/import";
import { matchPlayers, type Match } from "../../lib/identity";
import { extractionPrompt } from "../../lib/prompt";

const labels = { name: "昵称", position: "职位", level: "等级", pathway: "途径", extraordinary_score: "非凡评分", prosperity: "繁荣度", weekly_activity: "周活跃", group: "分组", join_days: "入会天数" };
type Row = { member: Member; identity: string; manual: boolean; sourceName: string | null; remember: boolean; needsReview: boolean; search?: string };

function beijingToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default function ImportPage() {
  const [raw, setRaw] = useState("");
  const [inputMode, setInputMode] = useState<"file" | "paste">("paste");
  const [original, setOriginal] = useState<string | null>(null);
  const [date, setDate] = useState(beijingToday);
  const [context, setContext] = useState<ImportContext | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<"merge" | "replace" | "">("");
  const [complete, setComplete] = useState(false);
  const [review, setReview] = useState<ConfirmedMember[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [revoke, setRevoke] = useState("");
  const [discard, setDiscard] = useState(false);
  const discardDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (discard) discardDialog.current?.showModal(); else discardDialog.current?.close(); }, [discard]);
  const [removed, setRemoved] = useState<{ row: Row; index: number } | null>(null);
  const [identityIndex, setIdentityIndex] = useState<number | null>(null);
  const [identityMode, setIdentityMode] = useState<"start" | "existing">("start");
  const [identityChoice, setIdentityChoice] = useState("");
  const [identitySearch, setIdentitySearch] = useState("");
  const [identityRemember, setIdentityRemember] = useState(false);
  const identityDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (identityIndex !== null) identityDialog.current?.showModal(); else identityDialog.current?.close(); }, [identityIndex]);
  useEffect(() => {
    if (error || review || saved) document.getElementById(error ? "import-feedback" : saved ? "import-success" : "final-review")?.focus();
  }, [error, review, saved]);
  const matches = context ? matchPlayers(rows.map(r => r.member), context.players, { ...context, aliases: [...(context.aliases ?? []), ...rows.filter(r => r.remember && r.identity && r.identity !== "new" && r.sourceName).map((r,i) => ({ id: `pending-${i}`, player_id: r.identity, alias_name: r.sourceName! }))] }, date) : [];
  const pending = rows.filter(r => !r.identity).length;
  const newCount = rows.filter(r => r.identity === "new").length;
  const bulkNewCount = rows.filter((r,i) => !r.identity && matches[i].tier === "D" && r.member.name && !matches[i].reasons.length).length;
  const activeIdentity = identityIndex === null ? null : rows[identityIndex];
  const activeMatch = identityIndex === null ? null : matches[identityIndex];
  const identityPlayer = context?.players.find(p => p.id === identityChoice);
  const recommendedIds = new Set(activeMatch?.candidates.map(p => p.id) ?? []);
  const identityOptions = context ? [...(activeMatch?.candidates ?? []).flatMap(candidate => context.players.filter(p => p.id === candidate.id)), ...context.players.filter(p => !recommendedIds.has(p.id))].filter(p => !identitySearch || p.display_name.includes(identitySearch)) : [];
  function openIdentity(index: number) {
    setIdentityIndex(index); setIdentityMode("start"); setIdentityChoice(""); setIdentitySearch(""); setIdentityRemember(false);
  }
  function confirmIdentity() {
    if (identityIndex === null || !identityChoice) return;
    setRows(rows.map((r,i) => i === identityIndex ? { ...r, identity: identityChoice, manual: true, remember: identityRemember && identityChoice !== "new" } : r));
    invalidate();
    const next = rows.findIndex((r,i) => i !== identityIndex && !r.identity);
    if (next >= 0) openIdentity(next); else setIdentityIndex(null);
  }
  function invalidate() { setReview(null); setConfirmed(false); setRequestId(""); setError(""); }
  function members() { return validateRows(rows.map(r => ({ ...r.member, player_id: r.identity === "new" ? null : r.identity, source_name: r.sourceName, remember_alias: r.remember, identity_confirmed: r.manual }))); }
  function choose(i: number, identity: string) { setRows(rows.map((r,j) => j === i ? { ...r, identity, manual: true, remember: false } : r)); invalidate(); }
  async function api(path: string, body?: unknown) {
    const response = await fetch(path, { cache: "no-store", ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if ([401,403].includes(response.status)) { window.location.replace("/login"); throw Error("请重新登录或检查权限"); }
    if (!response.ok) throw Error(data.error ?? "请求失败，请重试");
    return data;
  }
  async function prepare() {
    setError(""); setNotice(""); setBusy(true);
    if (original === null && raw.trim() && new TextEncoder().encode(raw).length <= MAX_SOURCE_BYTES) setOriginal(raw);
    try {
      if (!validDate(date)) throw Error("请填写实际截图日期");
      const parsed = parseSource(raw);
      const data: ImportContext = await api(`/api/import-context?date=${date}`);
      const matched = matchPlayers(parsed.members, data.players, data, date);
      setContext(data); setRows(parsed.members.map((member,i) => ({ member, identity: matched[i].identity, manual: false, sourceName: typeof member.name === "string" ? member.name : null, remember: false, needsReview: !matched[i].identity })));
      setMode(data.snapshot ? "" : "replace"); setComplete(false); invalidate();
      setIdentityIndex(null);
    } catch (e) { setError(e instanceof Error ? e.message : "准备失败"); }
    finally { setBusy(false); }
  }
  function finalPreview() {
    try {
      if (!context || !mode) throw Error("请选择同日数据的处理方式");
      if (rows.some((r,i) => !r.manual && (!matches[i].identity || matches[i].identity !== r.identity))) throw Error("匹配结果需要重新确认，请手动选择有异常的玩家");
      const list = mergePreview(context.members, members(), mode);
      if (list.length > 200) throw Error("最终名单超过 200 人");
      setReview(list); setConfirmed(false); setRequestId(crypto.randomUUID()); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "请检查预览"); }
  }
  async function save() {
    if (!confirmed || !review || !context || !mode) return;
    setBusy(true); setError("");
    try {
      const result = await api("/api/imports", { raw_text: original ?? raw, snapshot_date: date, is_complete_roster: complete, mode, members: members(), request_id: requestId, expected_snapshot_id: context.snapshot?.id ?? null, confirmed: true });
      setSaved(true); setNotice(result.unchanged ? `与当前第 ${result.revision} 版相同，没有重复写入。` : `已保存 ${date} 第 ${result.revision} 版${result.replayed ? "（先前提交已成功，没有重复写入）" : "，旧版本已保留"}。`);
    } catch (e) { setError(e instanceof TypeError ? "连接失败，你的核对结果还在。请检查网络后再次点击确认导入，不会重复保存。" : e instanceof Error ? e.message : "暂时没能保存，请重试；你的核对结果还在。"); }
    finally { setBusy(false); }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!/\.json$/i.test(file.name) || file.size > MAX_SOURCE_BYTES) { setError("请选择不超过 128 KiB 的 .json 文件"); return; }
    try { setRaw(await file.text()); setOriginal(null); invalidate(); setNotice(`已读入「${file.name}」，填写截图日期后即可继续。`); } catch { setError("没能读到这个文件，请重新选择，或把 JSON 直接粘贴到下方。"); }
  }
  function reset() { setContext(null); setRows([]); setRaw(""); setOriginal(null); setDate(beijingToday()); setComplete(false); setMode(""); setSaved(false); setNotice(""); setDiscard(false); setRemoved(null); setIdentityIndex(null); invalidate(); }
  async function removeAlias(id: string) {
    setBusy(true); setError("");
    try {
      await api("/api/player-aliases", { revoke_id: id, confirmed: true });
      const next: ImportContext = await api(`/api/import-context?date=${date}`);
      const nextMatches = matchPlayers(rows.map(r => r.member), next.players, next, date);
      setContext(next); setRows(rows.map((r,i) => r.manual ? r : { ...r, identity: nextMatches[i].identity })); setRevoke(""); invalidate(); setNotice("别名关联已解除；历史快照保留，受影响的自动匹配已重新检查。");
    } catch(e) { setError(e instanceof Error ? e.message : "解除失败"); }
    finally { setBusy(false); }
  }
  function editRow(r: Row, i: number, match: Match) {
    const selected = context?.players.find(p => p.id === r.identity);
    const options = match.candidates.slice(0,3);
    const otherPlayers = context?.players.filter(p => !r.search || p.display_name.includes(r.search) || p.id === r.identity) ?? [];
    return <details className="identity-row identity-compact" key={i}>
      <summary className="identity-summary"><span className="muted">本次识别</span><strong>{r.member.name ?? "昵称没看清"}</strong><span className={`badge ${r.identity ? "resolved" : "warning"}`}>{r.identity ? "已对上" : "选择对应玩家"}</span>{r.identity && <span className="muted">{r.identity === "new" ? "新增玩家" : selected?.display_name}</span>}</summary>
      <div className="identity-body">
      {!r.identity ? <><p className="choice-prompt">{options.length ? "选对应的已有玩家" : "没找到相似名字，可以搜索已有玩家或新增。"}</p><div className="candidate-options">{options.map((p,j) => <Button key={p.id} className="candidate-option" onClick={() => choose(i,p.id)}><span><strong>{p.label}</strong>{context!.players.filter(x => x.display_name === p.label).length > 1 && <small>编号 {p.id.slice(-8)}</small>}</span><span className="badge">{j === 0 && options.length === 1 ? "推荐 · " : ""}{p.reasons[0]}</span><span aria-hidden="true">选择 →</span></Button>)}</div></> : <p className="chosen-identity"><span aria-hidden="true">✓ </span>{r.identity === "new" ? `新增玩家：${r.member.name}` : `已选：${selected?.display_name}`}<Button className="text-button" onClick={() => choose(i,"")}>重新选择</Button></p>}
      {r.manual && selected && r.sourceName && r.sourceName.trim() !== selected.display_name.trim() && <label className="check alias-memory"><Input type="checkbox" aria-label={`记住第 ${i+1} 行原始昵称`} checked={r.remember} onChange={e => { setRows(rows.map((x,j) => j === i ? { ...x, remember: e.target.checked } : x)); invalidate(); }} />记住AI错名「{r.sourceName}」，下次自动匹配到「{selected.display_name}」</label>}
      <details className="other-identity"><summary>{r.identity ? "改选其他玩家" : "选择其他玩家 / 新增"}</summary><label>搜索名字<Input aria-label={`搜索第 ${i+1} 条玩家`} placeholder="输入正确昵称" value={r.search ?? ""} onChange={e => setRows(rows.map((x,j) => j === i ? { ...x, search: e.target.value } : x))} /></label><label>选择玩家<Select aria-label={`第 ${i+1} 行玩家身份`} value={r.identity} onChange={e => choose(i,e.target.value)}><option value="">请选择</option><option value="new">新增玩家（确认不是已有玩家）</option>{otherPlayers.map(p => <option key={p.id} value={p.id}>{p.display_name}（{p.id.slice(-8)}）</option>)}</Select></label></details>
      <details className="row-tools"><summary>更多操作</summary>
      {match.reasons.map(reason => <p className="muted" key={reason}>{reason}</p>)}
      {r.identity === "new" && match.candidates.length > 0 && <p className="conflict">请确认不是上面的已有玩家，避免重复建档。</p>}
      <details><summary>修正第 {i+1} 行数据</summary><div className="identity-fields">{fields.map(k => <label key={k}>{labels[k]}<Input aria-label={`第 ${i+1} 行${labels[k]}`} value={r.member[k] ?? ""} placeholder="null" inputMode={(numericFields as readonly string[]).includes(k) ? "numeric" : "text"} onChange={e => { const text=e.target.value; const value=text === "" ? null : (numericFields as readonly string[]).includes(k) && /^\d+$/.test(text) ? Number(text) : text; setRows(rows.map((x,j) => j === i ? { ...x, member: { ...x.member, [k]: value }, ...(k === "name" ? { identity: "", manual: false, remember: false } : {}) } : x)); invalidate(); }} /></label>)}</div></details>
      <Button className="text-button danger" onClick={() => { setRemoved({ row: r, index: i }); setRows(rows.filter((_,j) => j !== i)); invalidate(); }}>移除此行</Button></details>
      </div>
    </details>;
  }
  return <AppShell><main className="club-workspace club-import">
    <PageHeader eyebrow="03 / DAILY RECORD" title={saved ? "导入完成" : review ? "确认保存" : context ? "核对成员" : "导入每日数据"} />
    {!context && !saved && <p className="lede">上传识别结果，再核对名单。</p>}
    {context && !review && !saved && <p className="lede">把识别结果对上已有玩家，避免重复新增。点开下面的名字，选已有玩家或新增。</p>}
    <ol className="stepper" aria-label="导入进度">{["准备数据", "核对成员", "确认保存"].map((label,i) => <li key={label} aria-current={!saved && i === (review ? 2 : context ? 1 : 0) ? "step" : undefined} className={saved || i < (review ? 2 : context ? 1 : 0) ? "done" : ""}><span>{String(i+1).padStart(2,"0")}</span>{label}</li>)}</ol>
    {!context && !saved && <div className="ai-toolbar"><Button onClick={async () => { try { await navigator.clipboard.writeText(extractionPrompt); setNotice("AI识别提示词已复制"); } catch { setError("复制失败，请展开帮助里的完整提示词手动复制。"); } }}>复制AI识别提示词</Button><details className="ai-help"><summary aria-label="查看截图识别方法" title="怎么使用？">?</summary><div className="ai-help-content"><h3>怎么导入？</h3><ol><li>复制AI识别提示词，粘贴给 AI。</li><li>上传游戏成员截图。</li><li>把 AI 返回的 JSON 粘贴或上传到这里。</li></ol><a href="https://www.doubao.com/chat/" target="_blank" rel="noopener noreferrer">打开豆包 ↗</a><details><summary>完整AI识别提示词</summary><pre className="prompt">{extractionPrompt}</pre></details></div></details></div>}
    {!context && !saved && <p className="ai-recommendation">* 建议使用<a href="https://www.doubao.com/chat/" target="_blank" rel="noopener noreferrer">豆包</a>，选择「专家」。</p>}
    <p role="status" className="feedback success">{notice}</p><p id="import-feedback" tabIndex={-1} role="alert" className="feedback error">{error.replace(/extraordinary_score|weekly_activity|join_days|prosperity|pathway|player_id/g, key => ({ extraordinary_score:"非凡评分", weekly_activity:"周活跃", join_days:"入会天数", prosperity:"繁荣度", pathway:"途径", player_id:"玩家身份" })[key] ?? key)}</p>
    {saved ? <section className="panel success-card" id="import-success" tabIndex={-1}><span className="badge">已完成</span><h2>今天的记录，保存好了。</h2><p>可以放心离开这个页面，或继续导入其他日期的数据。</p><Button className="button" onClick={reset}>开始另一批导入</Button><Link href="/account">回到工作台</Link></section> : <fieldset disabled={busy} aria-busy={busy}>
      {!context ? <section className="panel input-panel">
        <label htmlFor="date">截图日期</label><Input id="date" type="date" min="2000-01-01" max="2100-12-31" value={date} onChange={e => setDate(e.target.value)} />
        <div className="input-switch" role="group" aria-label="导入方式"><Button aria-pressed={inputMode === "paste"} onClick={() => setInputMode("paste")}>粘贴内容</Button><Button aria-pressed={inputMode === "file"} onClick={() => setInputMode("file")}>上传文件</Button></div>
        <div hidden={inputMode !== "file"}><label htmlFor="file">JSON 文件</label><Input id="file" type="file" accept=".json,application/json" onChange={e => void upload(e.target.files?.[0])} /></div>
        <div hidden={inputMode !== "paste"}><label htmlFor="raw">JSON 内容</label><Textarea id="raw" rows={9} placeholder="把 AI 的识别结果粘贴到这里" value={raw} onChange={e => setRaw(e.target.value)} spellCheck={false} /></div>
        <Button className="button" onClick={() => void prepare()}>{busy ? "正在读取…" : "下一步"}</Button>
      </section> : <>
        <div hidden={!!review} className="review-workspace">
        <div className="review-overview"><span>{date} · {rows.length} 人</span><strong className={pending ? "pending-count" : "ready-count"}>{pending ? `还有 ${pending} 人没对上` : "全部已对上"}</strong>{newCount > 0 && <span>新增 {newCount} 人</span>}</div>
        {context.baseline && rows.length < context.baseline.count && <p className="conflict">比上次少 {context.baseline.count - rows.length} 人，请检查是否漏图。</p>}
        {bulkNewCount > 0 && <Button onClick={() => { setRows(rows.map((r,i) => !r.identity && matches[i].tier === "D" && r.member.name && !matches[i].reasons.length ? { ...r, identity: "new", manual: true } : r)); invalidate(); }}>确认这 {bulkNewCount} 人是新玩家</Button>}
        {removed && <div className="feedback">已移除「{removed.row.member.name ?? "未识别昵称"}」。<Button onClick={() => { setRows([...rows.slice(0,removed.index),removed.row,...rows.slice(removed.index)]); setRemoved(null); invalidate(); }}>撤销移除</Button></div>}
        {context.snapshot && <fieldset className="same-day-choice"><legend>这天已有数据，怎么更新？</legend><div className="same-day-options">{([
          ["merge", "只补充／修正部分玩家", "只更新本次玩家，其他人保留。当天名单人数不会减少。"],
          ["replace", "重新导入整份名单", "当天名单以本次为准。没导入的人不再显示在当天名单中。"],
        ] as const).map(([value, title, description]) => <label key={value} className={`same-day-option${mode === value ? " is-selected" : ""}`}><Input type="radio" name="import-mode" value={value} checked={mode === value} onChange={() => { setMode(value); invalidate(); }} /><span><strong>{title}</strong><small>{description}</small></span></label>)}</div><small className="same-day-note">两种方式都会保留旧版本，不删除历史记录。</small></fieldset>}
        <section className="pending-list">{rows.map((r,i) => r.needsReview || !r.identity ? <Button className="identity-launcher" key={i} onClick={() => openIdentity(i)}><strong>{r.member.name ?? "昵称没看清"}</strong><span className={`badge ${r.identity ? "resolved" : "warning"}`}>{r.identity ? r.identity === "new" ? "新增玩家" : `已选：${context.players.find(p => p.id === r.identity)?.display_name}` : "选择玩家"}</span><span aria-hidden="true">›</span></Button> : null)}</section>
        {rows.some(r => !r.needsReview && r.identity) && <details className="matched-list"><summary>{rows.filter(r => !r.needsReview && r.identity).length} 人已自动对上</summary>{rows.map((r,i) => !r.needsReview && r.identity ? editRow(r,i,matches[i]) : null)}</details>}
        <details className="review-settings"><summary>更多设置</summary>{(context.aliases?.length ?? 0) > 0 && <details><summary>已记住的名字（{context.aliases?.length}）</summary>{context.aliases?.map(a => <p key={a.id}>{a.alias_name} → {context.players.find(p => p.id === a.player_id)?.display_name} {revoke === a.id ? <><Button onClick={() => void removeAlias(a.id)}>确认解除此别名</Button><Button onClick={() => setRevoke("")}>取消</Button></> : <Button onClick={() => setRevoke(a.id)}>解除错误关联</Button>}</p>)}</details>}<Button className="text-button danger" onClick={() => setDiscard(true)}>放弃本批并重新开始</Button></details>
        <div className="review-next"><Button className="button" disabled={pending > 0 || !mode} onClick={finalPreview}>下一步 →</Button></div>
        </div>
        {review && <section className="panel" id="final-review" tabIndex={-1}><Button className="text-button" onClick={invalidate}>← 返回核对，继续修改</Button><h2>最终预览 · {review.length} 人</h2><p className="match-summary">新增 {review.filter(r => r.player_id === null).length} 人 · 既有 {review.filter(r => r.player_id !== null).length} 人 · 待确认 0 人</p><p>{complete ? "已人工确认完整名单。" : "不完整名单，不作为离会判断依据。"}{mode === "replace" ? "本次保存这份名单，之前的版本仍会保留。" : "保留此前未提交的玩家，更新本次核对的记录。"}</p>
          <div className="table-scroll"><table><thead><tr><th>正式身份</th><th>AI 原始昵称</th>{fields.map(k => <th key={k}>{labels[k]}</th>)}</tr></thead><tbody>{review.map((r,i) => <tr key={i}><td>{r.player_id ? `${context.players.find(p => p.id === r.player_id)?.display_name ?? "既有玩家"}（${r.player_id.slice(-8)}）` : "人工确认的新玩家"}</td><td>{r.source_name === undefined ? "旧记录未单列；原始 JSON 已保留" : r.source_name ?? "null"}</td>{fields.map(k => <td key={k}>{r[k] ?? "null"}</td>)}</tr>)}</tbody></table></div>
          <label className="check"><Input type="checkbox" checked={complete} onChange={e => { setComplete(e.target.checked); setConfirmed(false); setRequestId(crypto.randomUUID()); setError(""); }} />完整名单，没有漏人</label>
          <label className="check"><Input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我已核对名单，确认日期、成员身份和数据无误。</label>
          <Button className="button" disabled={!confirmed} onClick={() => void save()}>{busy ? "正在保存…" : "确认导入"}</Button><p>连接失败可重试同一次提交，不会重复写入；若同日数据变化，请重新开始并核对最新预览。</p>
        </section>}
      </>}
    </fieldset>}
    <dialog ref={identityDialog} onCancel={() => setIdentityIndex(null)} aria-labelledby="identity-title" className="panel identity-dialog">{activeIdentity && <>
      <div className="identity-dialog-top"><span className="muted">{pending ? `还剩 ${pending} 人` : "修改选择"}</span><Button className="text-button" aria-label="关闭玩家确认" onClick={() => setIdentityIndex(null)}>×</Button></div>
      <p className="identity-source"><span>本次识别</span><strong>{activeIdentity.member.name ?? "昵称没看清"}</strong></p>
      <h2 id="identity-title">这是新玩家，还是已有玩家？</h2>
      <div className="identity-type"><Button aria-pressed={identityChoice === "new"} disabled={!activeIdentity.member.name} onClick={() => { setIdentityMode("start"); setIdentityChoice("new"); setIdentityRemember(false); }}>新增玩家</Button><Button aria-pressed={identityMode === "existing"} onClick={() => { setIdentityMode("existing"); setIdentityChoice(""); setIdentityRemember(false); }}>选择已有玩家</Button></div>
      {identityChoice === "new" && <label className="identity-new-name">新玩家昵称<Input value={activeIdentity.member.name ?? ""} onChange={e => setRows(rows.map((r,i) => i === identityIndex ? { ...r, member: { ...r.member, name: e.target.value || null } } : r))} /></label>}
      {identityMode === "existing" && <div className="identity-picker"><label htmlFor="identity-search">已有玩家</label><Input id="identity-search" value={identitySearch} placeholder="搜索名字（可选）" onChange={e => setIdentitySearch(e.target.value)} />
        <div className="identity-picker-list">{identityOptions.map(p => { const used = rows.some((r,i) => i !== identityIndex && r.identity === p.id); return <Button key={p.id} disabled={used} aria-pressed={identityChoice === p.id} onClick={() => { setIdentityChoice(p.id); setIdentityRemember(false); }}><strong>{p.display_name}{context!.players.filter(other => other.display_name === p.display_name).length > 1 && <small>（{p.id.slice(-8)}）</small>}</strong><span>{used ? "本次已选" : identityChoice === p.id ? "✓" : recommendedIds.has(p.id) ? "推荐" : ""}</span></Button>; })}</div>
        {identitySearch && !context!.players.some(p => p.display_name.includes(identitySearch)) && <p className="muted">没找到这个名字。</p>}
        {identityPlayer && activeIdentity.sourceName && activeIdentity.sourceName.trim() !== identityPlayer.display_name.trim() && <label className="check"><Input type="checkbox" checked={identityRemember} onChange={e => setIdentityRemember(e.target.checked)} />记住这个AI错名，下次自动匹配到「{identityPlayer.display_name}」</label>}
      </div>}
      <details className="identity-extra"><summary>修改识别数据</summary><div className="identity-fields">{fields.map(k => <label key={k}>{labels[k]}<Input value={activeIdentity.member[k] ?? ""} placeholder="未识别" inputMode={(numericFields as readonly string[]).includes(k) ? "numeric" : "text"} onChange={e => { const text=e.target.value; const value=text === "" ? null : (numericFields as readonly string[]).includes(k) && /^\d+$/.test(text) ? Number(text) : text; setRows(rows.map((r,i) => i === identityIndex ? { ...r, member: { ...r.member, [k]: value } } : r)); }} /></label>)}</div><Button className="text-button danger" onClick={() => { setRemoved({ row: activeIdentity, index: identityIndex! }); setRows(rows.filter((_,i) => i !== identityIndex)); setIdentityIndex(null); invalidate(); }}>移除重复记录</Button></details>
      <div className="identity-dialog-footer"><Button className="text-button" onClick={() => setIdentityIndex(null)}>稍后处理</Button><Button className="button" disabled={!identityChoice} onClick={confirmIdentity}>{pending > 1 ? "确认，下一位 →" : "确认"}</Button></div>
    </>}</dialog>
    <dialog ref={discardDialog} onCancel={() => setDiscard(false)} aria-labelledby="discard-title" className="panel discard-dialog"><h2 id="discard-title">要放弃这次核对吗？</h2><p>这批还没有保存。放弃后，需要重新上传并核对。</p><div className="actions"><Button className="button" onClick={() => setDiscard(false)}>继续核对</Button><Button onClick={reset}>确认放弃</Button></div></dialog>
    <p><Link href="/account">返回账户</Link></p>
  </main></AppShell>;
}
