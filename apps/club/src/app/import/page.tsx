"use client";
import Link from "next/link";
import { useState } from "react";
import { fields, numericFields, parseSource, validateRows, matchName, mergePreview, validDate, MAX_SOURCE_BYTES, type Member, type ImportContext, type ConfirmedMember } from "../../lib/import";
import { extractionPrompt } from "../../lib/prompt";

const labels = { name: "昵称", position: "职位", level: "等级", pathway: "途径", extraordinary_score: "非凡评分", prosperity: "繁荣度", weekly_activity: "周活跃", group: "分组", join_days: "入会天数" };
type Row = { member: Member; identity: string };

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
  function invalidate() { setReview(null); setConfirmed(false); setRequestId(""); setError(""); }
  function members() { return validateRows(rows.map(r => ({ ...r.member, player_id: r.identity === "new" ? null : r.identity }))); }
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
      setContext(data); setRows(parsed.members.map(member => ({ member, identity: "" })));
      setMode(data.snapshot ? "" : "replace"); setComplete(false); invalidate();
    } catch (e) { setError(e instanceof Error ? e.message : "准备失败"); }
    finally { setBusy(false); }
  }
  function finalPreview() {
    try {
      if (!context || !mode) throw Error("请选择同日数据的处理方式");
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
    } catch (e) { setError(e instanceof Error ? e.message : "提交失败"); }
    finally { setBusy(false); }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!/\.json$/i.test(file.name) || file.size > MAX_SOURCE_BYTES) { setError("请选择不超过 128 KiB 的 .json 文件"); return; }
    try { setRaw(await file.text()); setOriginal(null); invalidate(); } catch { setError("文件读取失败，请重新选择或粘贴 JSON"); }
  }
  function reset() { setContext(null); setRows([]); setRaw(""); setOriginal(null); setDate(""); setComplete(false); setMode(""); setSaved(false); setNotice(""); invalidate(); }
  return <main className="import-shell">
    <Link className="brand" href="/account">SquirrelAPI / Club</Link><h1>导入每日数据</h1>
    <p>复制 Prompt → 打开 AI 上传截图 → 粘贴或上传 JSON → 修正并确认身份 → 预览并导入。</p>
    <button className="button" onClick={async () => { try { await navigator.clipboard.writeText(extractionPrompt); setNotice("完整 Prompt 已复制"); } catch { setError("复制失败，请手动复制下方 Prompt"); } }}>复制 AI 识别 Prompt</button>{" "}<a href="https://www.doubao.com/chat/" target="_blank" rel="noopener noreferrer">推荐使用豆包 ↗</a>
    <p>其他支持图片的 AI 也可以使用；上传前请去除无关私人信息，识别结果需要人工核对。</p>
    <details><summary>查看完整 Prompt</summary><pre className="prompt">{extractionPrompt}</pre></details>
    <p role="status">{notice}</p><p role="alert">{error}</p>
    {saved ? <><p>本批次已结束；成员列表和历史查询将在后续阶段开放。</p><button className="button" onClick={reset}>开始另一批导入</button></> : <fieldset disabled={busy}>
      {!context ? <section>
        <label htmlFor="date">实际截图日期（可补录）</label><input id="date" type="date" min="2000-01-01" max="2100-12-31" value={date} onChange={e => setDate(e.target.value)} />
        <label htmlFor="file">上传 .json（最大 128 KiB）</label><input id="file" type="file" accept=".json,application/json" onChange={e => void upload(e.target.files?.[0])} />
        <label htmlFor="raw">JSON 原文</label><textarea id="raw" rows={12} value={raw} onChange={e => setRaw(e.target.value)} spellCheck={false} />
        <p>格式有误可在此修正；首次校验输入会保留为原始来源，提交时另存修正后的数据。</p>
        <button className="button" onClick={() => void prepare()}>{busy ? "正在校验…" : "校验并准备预览"}</button>
      </section> : <>
        <h2>{date} · 核对 {rows.length} 条记录</h2><p>身份默认未确认；形近字和装饰符号仅用于候选提示，不会自动认定同一人。</p>
        <div className="table-scroll"><table><thead><tr><th>身份与冲突</th>{fields.map(k => <th key={k}>{labels[k]}</th>)}<th>操作</th></tr></thead><tbody>{rows.map((r,i) => {
          const normalized = typeof r.member.name === "string" ? matchName(r.member.name) : "";
          const candidates = context.players.filter(p => normalized && (p.match_name === normalized || matchName(p.display_name) === normalized));
          const duplicate = normalized && rows.filter(x => typeof x.member.name === "string" && matchName(x.member.name) === normalized).length > 1;
          return <tr key={i}><td><select aria-label={`第 ${i+1} 行玩家身份`} value={r.identity} onChange={e => { setRows(rows.map((x,j) => j === i ? { ...x, identity: e.target.value } : x)); invalidate(); }}>
            <option value="">请选择身份</option><option value="new">人工确认：新玩家</option>{context.players.map(p => <option key={p.id} value={p.id}>{p.display_name}（{p.id.slice(-8)}）</option>)}
          </select>{candidates.length > 0 && <p>候选：{candidates.map(p => `${p.display_name}（${p.id.slice(-8)}）`).join("、")}</p>}{candidates.length > 0 && r.identity === "new" && <p className="conflict">已有相似昵称。重复导入请选既有玩家；只有确认是不同的人，才能创建新玩家。</p>}{duplicate && <p className="conflict">同批存在相同或相似昵称，请核对重复、冲突或同名玩家。</p>}</td>
          {fields.map(k => <td key={k}><input aria-label={`第 ${i+1} 行${labels[k]}`} value={r.member[k] ?? ""} placeholder="null" inputMode={(numericFields as readonly string[]).includes(k) ? "numeric" : "text"} onChange={e => { const text=e.target.value; const value=text === "" ? null : (numericFields as readonly string[]).includes(k) && /^\d+$/.test(text) ? Number(text) : text; setRows(rows.map((x,j) => j === i ? { ...x, member: { ...x.member, [k]: value } } : x)); invalidate(); }} /></td>)}
          <td><button onClick={() => { setRows(rows.filter((_,j) => j !== i)); invalidate(); }}>移除此行</button></td></tr>;
        })}</tbody></table></div>
        {context.snapshot && <><p className="conflict">同日已有第 {context.snapshot.revision} 版、{context.members.length} 人；此次提交保留旧版。</p><label htmlFor="mode">同日处理方式（必须选择）</label><select id="mode" value={mode} onChange={e => { setMode(e.target.value as "merge" | "replace" | ""); invalidate(); }}><option value="">请选择</option><option value="merge">补录／合并：保留未提交玩家，已提交玩家使用本批九项值</option><option value="replace">替换当日名单：新版本仅包含本批，保留旧版</option></select></>}
        <p>空字段表示明确的 null，会替换该玩家当天的旧值；不自动填零或继承旧值。</p>
        <label className="check"><input type="checkbox" checked={complete} onChange={e => { setComplete(e.target.checked); invalidate(); }} />已提供完整成员名单（默认不勾选；仅指最终预览名单）</label>
        <button className="button" onClick={finalPreview}>生成最终预览</button>{" "}<button onClick={reset}>放弃本批并重新开始</button>
        {review && <section><h2>最终预览 · {review.length} 人</h2><p>{complete ? "已人工确认完整名单。" : "不完整名单，不作为离会判断依据。"}{mode === "replace" ? "新版本只含本批名单。" : "包含保留旧记录与本批修正。"}</p>
          <div className="table-scroll"><table><thead><tr><th>身份</th>{fields.map(k => <th key={k}>{labels[k]}</th>)}</tr></thead><tbody>{review.map((r,i) => <tr key={i}><td>{r.player_id ? `既有玩家 ${r.player_id.slice(-8)}` : "人工确认的新玩家"}</td>{fields.map(k => <td key={k}>{r[k] ?? "null"}</td>)}</tr>)}</tbody></table></div>
          <label className="check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我已逐行核对身份、同名和重复冲突，并确认日期、空值及最终名单正确。</label>
          <button className="button" disabled={!confirmed} onClick={() => void save()}>{busy ? "正在保存…" : "确认导入"}</button><p>连接失败可重试同一次提交，不会重复写入；若同日数据变化，请重新开始并核对最新预览。</p>
        </section>}
      </>}
    </fieldset>}
    <p><Link href="/account">返回账户</Link></p>
  </main>;
}
