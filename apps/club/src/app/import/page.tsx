"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fields, numericFields, parseSource, validateRows, mergePreview, validDate, MAX_SOURCE_BYTES, type Member, type ImportContext, type ConfirmedMember } from "../../lib/import";
import { matchPlayers, type Match } from "../../lib/identity";
import { extractionPrompt } from "../../lib/prompt";

const labels = { name: "昵称", position: "职位", level: "等级", pathway: "途径", extraordinary_score: "非凡评分", prosperity: "繁荣度", weekly_activity: "周活跃", group: "分组", join_days: "入会天数" };
type Row = { member: Member; identity: string; manual: boolean; sourceName: string | null; remember: boolean; needsReview: boolean };

export default function ImportPage() {
  const [raw, setRaw] = useState("");
  const [original, setOriginal] = useState<string | null>(null);
  const [date, setDate] = useState("");
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
  useEffect(() => {
    if (error || review || saved) document.getElementById(error ? "import-feedback" : saved ? "import-success" : "final-review")?.focus();
  }, [error, review, saved]);
  const matches = context ? matchPlayers(rows.map(r => r.member), context.players, { ...context, aliases: [...(context.aliases ?? []), ...rows.filter(r => r.remember && r.identity && r.identity !== "new" && r.sourceName).map((r,i) => ({ id: `pending-${i}`, player_id: r.identity, alias_name: r.sourceName! }))] }, date) : [];
  const pending = rows.filter(r => !r.identity).length;
  const newCount = rows.filter(r => r.identity === "new").length;
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
  function reset() { setContext(null); setRows([]); setRaw(""); setOriginal(null); setDate(""); setComplete(false); setMode(""); setSaved(false); setNotice(""); setDiscard(false); setRemoved(null); invalidate(); }
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
    return <div className="identity-row" key={i}>
      <div className="row-heading"><h3>{r.member.name ?? "昵称未识别"}</h3><span className={`badge ${r.identity ? "resolved" : "warning"}`}>{r.identity === "new" ? "已确认新增" : r.identity ? "身份已确认" : match.tier === "D" ? "可能是新成员" : "请确认身份"}</span></div>
      <p className="muted">记录 {i+1} · 截图识别：{r.sourceName ?? "未识别"}{r.identity && r.identity !== "new" ? ` → ${context?.players.find(p => p.id === r.identity)?.display_name}` : ""}</p>
      {match.reasons.map(reason => <p className="conflict" key={reason}>{reason}</p>)}
      {!r.identity && match.candidates.map(p => <p key={p.id}><button onClick={() => choose(i,p.id)}>确认是 {p.label}（{p.id.slice(-8)}）</button> {p.reasons.join("；")}</p>)}
      <label>身份<select aria-label={`第 ${i+1} 行玩家身份`} value={r.identity} onChange={e => choose(i,e.target.value)}><option value="">请选择身份</option><option value="new">人工确认：新玩家／同名不同人</option>{context?.players.map(p => <option key={p.id} value={p.id}>{p.display_name}（{p.id.slice(-8)}）</option>)}</select></label>
      {r.identity === "new" && match.candidates.length > 0 && <p className="conflict">已有相似昵称，仅在确认是不同的人时创建新玩家。</p>}
      {r.manual && r.identity && r.identity !== "new" && r.sourceName && r.sourceName.trim() !== context?.players.find(p => p.id === r.identity)?.display_name.trim() && <label className="check"><input type="checkbox" checked={r.remember} onChange={e => { setRows(rows.map((x,j) => j === i ? { ...x, remember: e.target.checked } : x)); invalidate(); }} />记住第 {i+1} 行原始昵称为此玩家的确认别名（不改正式昵称）</label>}
      <details><summary>修正第 {i+1} 行数据</summary><div className="identity-fields">{fields.map(k => <label key={k}>{labels[k]}<input aria-label={`第 ${i+1} 行${labels[k]}`} value={r.member[k] ?? ""} placeholder="null" inputMode={(numericFields as readonly string[]).includes(k) ? "numeric" : "text"} onChange={e => { const text=e.target.value; const value=text === "" ? null : (numericFields as readonly string[]).includes(k) && /^\d+$/.test(text) ? Number(text) : text; setRows(rows.map((x,j) => j === i ? { ...x, member: { ...x.member, [k]: value }, ...(k === "name" ? { identity: "", manual: false, remember: false } : {}) } : x)); invalidate(); }} /></label>)}</div></details>
      <button className="text-button danger" onClick={() => { setRemoved({ row: r, index: i }); setRows(rows.filter((_,j) => j !== i)); invalidate(); }}>移除此行</button>
    </div>;
  }
  return <main className="import-shell">
    <p className="eyebrow">每日记录</p><h1>导入每日数据</h1>
    <p className="lede">把识别结果交给我们，熟悉的玩家自动匹配。你只需确认不确定的地方。</p>
    <ol className="stepper" aria-label="导入进度">{["准备数据", "核对成员", "确认保存"].map((label,i) => <li key={label} aria-current={!saved && i === (review ? 2 : context ? 1 : 0) ? "step" : undefined} className={saved || i < (review ? 2 : context ? 1 : 0) ? "done" : ""}><span>{String(i+1).padStart(2,"0")}</span>{label}</li>)}</ol>
    {!context && !saved && <details className="panel ai-guide" open><summary>还没有识别结果？从这里开始</summary><p>复制下面的识别说明，在豆包或其他支持图片的 AI 中粘贴，再上传全部成员截图。</p>
    <button className="button" onClick={async () => { try { await navigator.clipboard.writeText(extractionPrompt); setNotice("完整 Prompt 已复制"); } catch { setError("复制失败，请手动复制下方 Prompt"); } }}>复制 AI 识别 Prompt</button>{" "}<a href="https://www.doubao.com/chat/" target="_blank" rel="noopener noreferrer">推荐使用豆包 ↗</a>
    <p className="muted">拿到 JSON 后回到这里继续。上传截图前，请遮住无关的私人信息。</p>
    <details><summary>查看完整 Prompt</summary><pre className="prompt">{extractionPrompt}</pre></details>
    </details>}
    <p role="status" className="feedback success">{notice}</p><p id="import-feedback" tabIndex={-1} role="alert" className="feedback error">{error.replace(/extraordinary_score|weekly_activity|join_days|prosperity|pathway|player_id/g, key => ({ extraordinary_score:"非凡评分", weekly_activity:"周活跃", join_days:"入会天数", prosperity:"繁荣度", pathway:"途径", player_id:"玩家身份" })[key] ?? key)}</p>
    {saved ? <section className="panel success-card" id="import-success" tabIndex={-1}><span className="badge">已完成</span><h2>今天的记录，保存好了。</h2><p>可以放心离开这个页面，或继续导入其他日期的数据。</p><button className="button" onClick={reset}>开始另一批导入</button><Link href="/account">回到工作台</Link></section> : <fieldset disabled={busy} aria-busy={busy}>
      {!context ? <section className="panel input-panel"><h2>准备好识别结果了吗？</h2><p className="muted">选择截图对应的日期，再上传文件或粘贴内容，二选一即可。</p>
        <label htmlFor="date">实际截图日期（可补录）</label><input id="date" type="date" min="2000-01-01" max="2100-12-31" value={date} onChange={e => setDate(e.target.value)} />
        <label htmlFor="file">上传 .json（最大 128 KiB）</label><input id="file" type="file" accept=".json,application/json" onChange={e => void upload(e.target.files?.[0])} />
        <label htmlFor="raw">JSON 原文</label><textarea id="raw" rows={12} value={raw} onChange={e => setRaw(e.target.value)} spellCheck={false} />
        <p className="muted">这里还不会保存数据。下一步可以检查名单、修正识别错误。</p>
        <button className="button" onClick={() => void prepare()}>{busy ? "正在校验…" : "校验并准备预览"}</button>
      </section> : <>
        <div hidden={!!review} className="review-workspace">
        <h2>{date} · 核对 {rows.length} 条记录</h2>
        <p className="match-summary">已匹配 {rows.filter(r => r.identity && r.identity !== "new").length} 人 · 已确认新增 {newCount} 人 · 待确认 {pending} 人</p>
        <p className="muted">准确昵称和已确认别名已自动关联。相似名字只作推荐，请你来做最后判断。</p>
        {context.baseline && rows.length < context.baseline.count && <p className="conflict">上次参考名单（{context.baseline.snapshot_date}）{context.baseline.count} 人，本次只有 {rows.length} 人，请检查截图遗漏；不会据此认定缺席玩家离会。</p>}
        <button onClick={() => { setRows(rows.map((r,i) => !r.identity && matches[i].tier === "D" && r.member.name && !matches[i].reasons.length ? { ...r, identity: "new", manual: true } : r)); invalidate(); }}>批量确认无冲突的疑似新玩家</button>
        {removed && <div className="feedback">已移除「{removed.row.member.name ?? "未识别昵称"}」。<button onClick={() => { setRows([...rows.slice(0,removed.index),removed.row,...rows.slice(removed.index)]); setRemoved(null); invalidate(); }}>撤销移除</button></div>}
        <section><h3>{pending ? `还有 ${pending} 位成员需要你看一眼` : "名单已核对，可以继续了"}</h3>{rows.map((r,i) => r.needsReview ? editRow(r,i,matches[i]) : null)}{pending === 0 && <p className="feedback success">没有待确认记录，可直接生成最终预览。</p>}</section>
        <details className="panel"><summary>查看或手动修正已匹配／已确认记录（{rows.filter(r => !r.needsReview).length}）</summary>{rows.map((r,i) => !r.needsReview ? editRow(r,i,matches[i]) : null)}</details>
        <details><summary>查看与解除确认别名（{context.aliases?.length ?? 0}）</summary><p>解除只停止未来自动关联，历史导入和审计保留；历史误选请用同日修正重新导入。</p>{context.aliases?.map(a => <p key={a.id}>{a.alias_name} → {context.players.find(p => p.id === a.player_id)?.display_name}（{a.player_id.slice(-8)}） {revoke === a.id ? <><button onClick={() => void removeAlias(a.id)}>确认解除此别名</button><button onClick={() => setRevoke("")}>取消</button></> : <button onClick={() => setRevoke(a.id)}>解除错误关联</button>}</p>)}</details>
        {context.snapshot && <><p className="conflict">同日已有第 {context.snapshot.revision} 版、{context.members.length} 人；此次提交保留旧版。</p><label htmlFor="mode">同日处理方式（必须选择）</label><select id="mode" value={mode} onChange={e => { setMode(e.target.value as "merge" | "replace" | ""); invalidate(); }}><option value="">请选择</option><option value="merge">补录／合并：保留未提交玩家，已提交玩家使用本批九项值</option><option value="replace">替换当日名单：新版本仅包含本批，保留旧版</option></select></>}
        <p className="muted">留空表示这次没有识别到，保存时不会自动补成 0；同日修正会以本次填写的内容为准。</p>
        <label className="check"><input type="checkbox" checked={complete} onChange={e => { setComplete(e.target.checked); invalidate(); }} />已提供完整成员名单（默认不勾选；仅指最终预览名单）</label>
        <div className="action-bar"><div><strong>{pending ? `请先确认剩余 ${pending} 位成员` : "所有身份已就绪"}</strong><p>下一步会展示最终保存的完整名单。</p></div><button className="button" disabled={pending > 0 || !mode} onClick={finalPreview}>生成最终预览</button><button className="text-button" onClick={() => setDiscard(true)}>放弃本批并重新开始</button></div>
        </div>
        {review && <section className="panel" id="final-review" tabIndex={-1}><button className="text-button" onClick={invalidate}>← 返回核对，继续修改</button><h2>最终预览 · {review.length} 人</h2><p className="match-summary">新增 {review.filter(r => r.player_id === null).length} 人 · 既有 {review.filter(r => r.player_id !== null).length} 人 · 待确认 0 人</p><p>{complete ? "已人工确认完整名单。" : "不完整名单，不作为离会判断依据。"}{mode === "replace" ? "本次保存这份名单，之前的版本仍会保留。" : "保留此前未提交的玩家，更新本次核对的记录。"}</p>
          <div className="table-scroll"><table><thead><tr><th>正式身份</th><th>AI 原始昵称</th>{fields.map(k => <th key={k}>{labels[k]}</th>)}</tr></thead><tbody>{review.map((r,i) => <tr key={i}><td>{r.player_id ? `${context.players.find(p => p.id === r.player_id)?.display_name ?? "既有玩家"}（${r.player_id.slice(-8)}）` : "人工确认的新玩家"}</td><td>{r.source_name === undefined ? "旧记录未单列；原始 JSON 已保留" : r.source_name ?? "null"}</td>{fields.map(k => <td key={k}>{r[k] ?? "null"}</td>)}</tr>)}</tbody></table></div>
          <label className="check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我已核对名单，确认日期、成员身份和数据无误。</label>
          <button className="button" disabled={!confirmed} onClick={() => void save()}>{busy ? "正在保存…" : "确认导入"}</button><p>连接失败可重试同一次提交，不会重复写入；若同日数据变化，请重新开始并核对最新预览。</p>
        </section>}
      </>}
    </fieldset>}
    <dialog ref={discardDialog} onCancel={() => setDiscard(false)} aria-labelledby="discard-title" className="panel discard-dialog"><h2 id="discard-title">要放弃这次核对吗？</h2><p>这批还没有保存。放弃后，需要重新上传并核对。</p><div className="actions"><button className="button" onClick={() => setDiscard(false)}>继续核对</button><button onClick={reset}>确认放弃</button></div></dialog>
    <p><Link href="/account">返回账户</Link></p>
  </main>;
}
