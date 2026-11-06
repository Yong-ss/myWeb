"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {toast} from "../../components/ui/sonner";
import {clubApi} from "../../lib/data-access";
import {useClubCan,useClubHref} from "../../lib/useClub";
import {PageHeader} from "../../components/layout/PageHeader";
import {Button,ButtonLink} from "../../components/ui/button";
import {Notice} from "../../components/ui/notice";
import {Input} from "../../components/ui/input";
import {Textarea} from "../../components/ui/textarea";
import {Badge} from "../../components/ui/badge";
import {Card,CardDescription,CardTitle} from "../../components/ui/card";
import {Field,FieldLabel} from "../../components/ui/field";
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from "../../components/ui/collapsible";
import {AlertDialog,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogTitle} from "../../components/ui/alert-dialog";
import {LoadingState} from "../../components/feedback";
import type {NameAlias} from "../../domain/names";
import {eventToday} from "./contract";
import type {RosterPlayer} from "./highland";
import {applyDragonChoices,classifyDragon,dragonPlayers,dragonPrompt,parseDragonSource,type Choice,type Entry} from "./dragon";
import {IdentityPicker} from "./EventInputs";
import {ImportStepper,PromptBar} from "../../components/ImportSteps";

type Identities={players:RosterPlayer[];aliases:NameAlias[];can_alias:boolean;truncated:boolean;roster_date:string|null};

/** Screenshot names → this club's players. Unmatched names are left out and only counted. */
export function DragonImportPage(){
 const href=useClubHref(),can=useClubCan(),router=useRouter();
 const [date,setDate]=useState(eventToday),[raw,setRaw]=useState("");
 const [ids,setIds]=useState<Identities|null>(null),[rows,setRows]=useState<(string|null)[]>([]),[removed,setRemoved]=useState(0);
 const [choices,setChoices]=useState<Record<number,Choice>>({}),[remember,setRemember]=useState<Record<string,boolean>>({});
 const [picker,setPicker]=useState<Entry|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[confirm,setConfirm]=useState(false);
 const attempt=useRef<{key:string;id:string}|null>(null);
 useEffect(()=>{if(error)document.getElementById("dragon-import-error")?.focus();},[error]);

 const proposed=useMemo(()=>ids?classifyDragon(rows,ids.players,ids.aliases):[],[ids,rows]);
 const entries=applyDragonChoices(proposed,choices);
 const name=(id:string)=>ids?.players.find(p=>p.id===id)?.display_name??id;
 const {players,problems,review,skipped}=dragonPlayers(entries,remember,name);
 const matched=entries.filter(e=>e.decision==="match"),pending=entries.filter(e=>e.decision==="review");
 const ready=!!ids&&!review&&!problems.length&&players.length>0&&date<=eventToday();

 async function prepare(){
  setError("");
  if(!date||date>eventToday())return setError("请选择猎龙日期（不能是未来日期）");
  let parsed;try{parsed=parseDragonSource(raw);}catch(e){return setError(e instanceof Error?e.message:"JSON 无效");}
  setBusy(true);
  try{
   const [identities,list]=await Promise.all([clubApi<Identities>("/api/dragon-identities",undefined,"成员名单读取失败"),clubApi<{events:{event_date:string}[]}>("/api/dragon-events",undefined,"猎龙记录读取失败")]);
   if(list.events.some(e=>e.event_date===date)){setError(`${date} 已有猎龙记录；如需重新导入，请先在详情页作废原记录`);return;}
   setIds(identities);setRows(parsed.rows);setRemoved(parsed.removed);setChoices({});setRemember({});
  }catch(e){setError(e instanceof Error?e.message:"读取失败，请重试");}
  finally{setBusy(false);}
 }
 function pick(identity:string,keep:boolean){
  if(!picker)return;
  setChoices(c=>({...c,[picker.index]:{decision:"match",identity}}));
  if(keep)setRemember(r=>({...r,[identity]:true}));
  setPicker(pending.find(e=>e.index!==picker.index)??null);
 }
 async function submit(){
  setConfirm(false);setBusy(true);setError("");
  const body={event_date:date,players,unmatched:skipped.length},key=JSON.stringify(body);
  // One request id per exact content: a retry after a lost response is saved once.
  if(attempt.current?.key!==key)attempt.current={key,id:crypto.randomUUID()};
  try{
   const saved=await clubApi<{event_id:string}>("/api/dragon-events",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,request_id:attempt.current.id})},"保存失败，请重试");
   toast.success("猎龙出勤已保存");router.push(href(`/dragon/event?id=${saved.event_id}`));
  }catch(e){setError(`${e instanceof Error?e.message:"保存失败"}。可直接重试，同一份内容只会保存一次。`);}
  finally{setBusy(false);}
 }
 if(!can("dragon.import"))return <main className="club-workspace club-events flex flex-col gap-6"><PageHeader eyebrow="DRAGON HUNT / 导入出勤" title="导入猎龙"/><LoadingState status="empty" title="没有导入猎龙的权限" detail="需要猎龙的「查看出勤」和「导入出勤」两项权限。"/></main>;

 const item=(e:Entry)=><li key={e.index} className="flex flex-wrap items-center justify-between gap-2 border-b border-divider py-2 last:border-b-0">
  <span className="[overflow-wrap:anywhere]"><strong className="text-gold">{e.name??"昵称没看清"}</strong>{e.decision==="match"&&<> → {name(e.identity)}{ids?.players.find(p=>p.id===e.identity)?.current===false&&<Badge variant="warning" className="ml-1">不在最新名单</Badge>}</>}
   {e.decision!=="match"&&e.reasons.length>0&&<small className="block text-muted-foreground">{e.reasons.join("；")}</small>}</span>
  <span className="flex flex-wrap gap-1"><Button variant="secondary" size="compact" onClick={()=>setPicker(e)}>{e.decision==="match"?"改选玩家":"选择玩家"}</Button>
   {e.decision!=="skip"&&<Button variant="ghost" size="compact" onClick={()=>setChoices(c=>({...c,[e.index]:{decision:"skip"}}))}>不计入</Button>}</span></li>;

 return <main className="club-workspace club-events flex max-w-300 flex-col gap-6">
  <PageHeader eyebrow="DRAGON HUNT / 导入出勤" title={ids?"核对参加名单":"导入猎龙"} actions={<ButtonLink variant="secondary" href={href("/dragon")}>返回猎龙记录</ButtonLink>}/>
  <ImportStepper steps={["准备数据","核对名单","确认保存"]} step={confirm?2:ids?1:0}/>
  {!ids&&<PromptBar prompt={dragonPrompt} onCopy={()=>void navigator.clipboard?.writeText(dragonPrompt).then(()=>toast.success("AI识别提示词已复制"),()=>setError("复制失败，请点问号查看完整提示词手动复制。"))} howTo={<><li>截取猎龙参战名单的全部截图。</li><li>复制AI识别提示词，和截图一起发给 AI。</li><li>把 AI 返回的 JSON 粘贴到这里。</li></>}/>}
  {!ids&&<Card className="w-full"><CardTitle>选择日期并粘贴 JSON</CardTitle>
   <CardDescription>每天最多一次。只记录谁参加了；灰色名片也算参加。名单里找不到的人不会保存，只记人数。</CardDescription>
   <Field className="max-w-56"><FieldLabel htmlFor="dragon-date">猎龙日期</FieldLabel><Input id="dragon-date" type="date" max={eventToday()} value={date} onChange={e=>setDate(e.target.value)}/></Field>
   <Field><FieldLabel htmlFor="dragon-json">AI 输出的 JSON</FieldLabel><Textarea id="dragon-json" rows={8} value={raw} onChange={e=>setRaw(e.target.value)} placeholder='{"schema_version":1,"event_type":"dragon_hunt","participants":[{"player_name":"…"}]}'/></Field>
   <div className="flex flex-wrap gap-3"><Button loading={busy} loadingText="准备中…" onClick={prepare}>开始核对</Button></div>
  </Card>}
  {error&&<Notice variant="destructive" id="dragon-import-error" tabIndex={-1} role="alert">{error}</Notice>}
  {ids&&<Card className="w-full"><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>{date} 的参加名单</CardTitle><Button variant="ghost" size="compact" onClick={()=>setIds(null)}>← 返回修改</Button></div>
   <CardDescription>名字或已记住的写法与成员名单（最新 {ids.roster_date??"暂无名单"}）完全一致才会自动匹配；相似名字要你选择。</CardDescription>
   <dl className="m-0 flex flex-wrap gap-x-8 gap-y-2 text-sm" aria-label="核对进度">
    {([["截图名字",`${rows.length} 个`],["已匹配",`${players.length} 人`],["待确认",`${review} 个`],["不计入",`${skipped.length} 个`]] as const).map(([k,v])=><div key={k} className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="m-0 font-heading text-lg tabular-nums text-gold">{v}</dd></div>)}
   </dl>
   {ids.truncated&&<Notice variant="warning">玩家或别名超过一次可读取的上限，部分名字可能没有参与自动匹配。</Notice>}
   {removed>0&&<Notice variant="info">已合并 {removed} 个重复名字（截图重叠）。</Notice>}
   {problems.length>0&&<Notice as="ul" variant="warning" className="grid list-disc gap-1 pl-8" aria-label="需要处理的问题">{problems.map(p=><li key={p}>{p}</li>)}</Notice>}
   {pending.length>0&&<section className="grid gap-2" aria-label="待确认"><h3 className="m-0 font-heading text-base text-gold">待确认 {pending.length} 个（选择玩家或不计入）</h3><ul className="m-0 list-none p-0">{pending.map(item)}</ul></section>}
   {skipped.length>0&&<section className="grid gap-2" aria-label="不计入"><h3 className="m-0 font-heading text-base text-gold">不计入 {skipped.length} 个（不保存；可选择玩家找回）</h3><ul className="m-0 list-none p-0">{skipped.map(item)}</ul></section>}
   <Collapsible defaultOpen={!pending.length} className="rounded-sm border border-border"><CollapsibleTrigger className="px-4 text-gold">已匹配 {matched.length} 个</CollapsibleTrigger>
    <CollapsibleContent className="px-4 pb-2"><ul className="m-0 list-none p-0">{matched.map(item)}</ul></CollapsibleContent></Collapsible>
   <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-6">
    {!ready&&<span className="text-sm text-muted-foreground">{review?`还有 ${review} 个待确认。`:problems.length?"请先处理上面的问题。":!players.length?"至少要有 1 名参加者。":""}</span>}
    <Button disabled={!ready} loading={busy} loadingText="保存中…" onClick={()=>setConfirm(true)}>保存出勤</Button></div>
  </Card>}
  {ids&&picker&&<IdentityPicker open allowNew={false} title={`「${picker.name??"昵称没看清"}」是谁？`} sourceName={picker.name} players={[...ids.players].sort((a,b)=>Number(b.current)-Number(a.current))} candidates={picker.candidates}
   note={p=>(p as RosterPlayer).current?"":"不在最新名单"} used={new Set(matched.filter(e=>e.index!==picker.index).map(e=>e.identity))} current={picker.decision==="match"?picker.identity:""}
   remember={{allowed:ids.can_alias,checked:false}} onClose={()=>setPicker(null)} onPick={pick}/>}
  <AlertDialog open={confirm} onOpenChange={setConfirm}><AlertDialogContent className="max-h-[90vh] overflow-y-auto"><AlertDialogTitle>保存 {date} 的猎龙出勤？</AlertDialogTitle>
   <AlertDialogDescription>参加 {players.length} 人{skipped.length?`，另有 ${skipped.length} 个名字不计入`:""}。保存后不能逐人修改，有错请作废后重新导入。</AlertDialogDescription>
   <ol className="m-0 grid max-h-60 list-decimal gap-1 overflow-y-auto pl-6 text-sm" aria-label="参加名单">{players.map(p=><li key={p.player_id}>{name(p.player_id)}</li>)}</ol>
   <AlertDialogFooter><AlertDialogCancel asChild><Button variant="secondary">返回检查</Button></AlertDialogCancel><Button onClick={()=>void submit()}>确认保存</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </main>;
}
