"use client";
import {useId,useState} from "react";
import {Button} from "../../components/ui/button";
import {Input} from "../../components/ui/input";
import {Checkbox} from "../../components/ui/checkbox";
import {Field,FieldLabel} from "../../components/ui/field";
import {Dialog,DialogContent,DialogDescription,DialogTitle} from "../../components/ui/dialog";
import {metricLabels,outputFields,strategyFields,isNew,newIdentity,parseAmount,type Metric} from "./contract";
import type {NamedPlayer} from "../../domain/names";

/** Chooses who a row belongs to: a listed player (recommended first) or, after an explicit choice, a new player.
 * Nothing is saved here; the page sends the final choice with the whole confirmation. */
export function IdentityPicker({open,title,sourceName,players,candidates,used,current,allowNew=true,remember,onClose,onPick,onRemove}:{
 open:boolean;title:string;sourceName:string|null;players:NamedPlayer[];candidates:string[];used:Set<string>;current:string;allowNew?:boolean;
 remember?:{allowed:boolean;checked:boolean};onClose:()=>void;onPick:(identity:string,remember:boolean)=>void;onRemove?:()=>void}){
 return <Dialog open={open} onOpenChange={o=>{if(!o)onClose();}}><DialogContent className="max-h-[90vh] w-[min(32.5rem,calc(100vw-2rem))] overflow-y-auto">
  {open&&<Picker {...{title,sourceName,players,candidates,used,current,allowNew,remember,onClose,onPick,onRemove}}/>}
 </DialogContent></Dialog>;
}
function Picker({title,sourceName,players,candidates,used,current,allowNew,remember,onClose,onPick,onRemove}:Omit<Parameters<typeof IdentityPicker>[0],"open">){
 const id=useId();
 const [choice,setChoice]=useState(current),[search,setSearch]=useState(""),[name,setName]=useState(isNew(current)?current.slice(4):sourceName??""),[keep,setKeep]=useState(remember?.checked??false);
 const recommended=new Set(candidates);
 const options=[...candidates.flatMap(c=>players.filter(p=>p.id===c)),...players.filter(p=>!recommended.has(p.id))].filter(p=>!search||p.display_name.includes(search.trim())).slice(0,200);
 const creating=choice==="new";
 const picked=creating?(name.trim()?newIdentity(name):""):choice;
 const display=players.find(p=>p.id===choice)?.display_name;
 return <div className="flex flex-col gap-4">
  <DialogTitle>{title}</DialogTitle>
  <DialogDescription>本次识别：<strong className="text-gold [overflow-wrap:anywhere]">{sourceName??"昵称没看清"}</strong>。相似名字只是推荐，请确认是同一个人。</DialogDescription>
  <div className="grid grid-cols-2 gap-3">{allowNew&&<Button variant="secondary" aria-pressed={creating} onClick={()=>setChoice("new")}>新增玩家</Button>}<Button variant="secondary" aria-pressed={!creating} onClick={()=>setChoice(isNew(current)?"":current)}>选择已有玩家</Button></div>
  {creating?<Field><FieldLabel htmlFor={`${id}-name`}>新玩家昵称</FieldLabel><Input id={`${id}-name`} maxLength={200} value={name} onChange={e=>setName(e.target.value)}/><p className="m-0 text-xs text-muted-foreground">只在最终确认保存时建档；不会改变每日名单或入会状态。</p></Field>:<>
   <Field><FieldLabel htmlFor={`${id}-search`}>搜索玩家</FieldLabel><Input id={`${id}-search`} type="search" value={search} placeholder="输入名字（可选）" onChange={e=>setSearch(e.target.value)}/></Field>
   <div className="grid max-h-60 gap-2 overflow-y-auto overscroll-contain">{options.map(p=>{const taken=used.has(p.id)&&p.id!==current;return <Button key={p.id} variant="secondary" className="shrink-0 justify-between text-left" disabled={taken} aria-pressed={choice===p.id} onClick={()=>setChoice(p.id)}>
    <strong className="font-medium">{p.display_name}{players.filter(o=>o.display_name===p.display_name).length>1&&<small className="text-muted-foreground">（{p.id.slice(-8)}）</small>}</strong>
    <span className="text-xs text-muted-foreground">{taken?"本场已有":choice===p.id?"✓":recommended.has(p.id)?"推荐":""}</span></Button>;})}</div>
   {!options.length&&<p className="m-0 text-sm text-muted-foreground">没找到这个名字。</p>}
   {remember?.allowed&&display&&sourceName&&sourceName.trim()!==display&&<Field orientation="horizontal" className="rounded-sm border border-border bg-card p-3"><Checkbox id={`${id}-remember`} checked={keep} onCheckedChange={v=>setKeep(v===true)}/><FieldLabel htmlFor={`${id}-remember`}>记住这个 AI 错名，下次自动匹配到「{display}」</FieldLabel></Field>}
  </>}
  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-4">
   <span className="flex gap-2"><Button variant="ghost" onClick={onClose}>取消</Button>{onRemove&&<Button variant="ghost" className="text-destructive" onClick={onRemove}>移除此行</Button>}</span>
   <Button disabled={!picked} onClick={()=>onPick(picked,!creating&&keep)}>确认</Button></div>
 </div>;
}

/** The nine metrics as text fields: empty = unread (null, never 0); 万/亿 allowed and converted. */
export function MetricInputs({values,onChange,idPrefix}:{values:Partial<Record<Metric,number|null>>;onChange:(next:Partial<Record<Metric,number|null>>)=>void;idPrefix:string}){
 const [text,setText]=useState<Partial<Record<Metric,string>>>({});
 const group=(title:string,keys:readonly Metric[])=><fieldset className="m-0 grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3 border-0 p-0"><legend className="mb-2 text-sm text-gold">{title}</legend>{keys.map(k=>{
  const shown=text[k]??(values[k]==null?"":String(values[k])),bad=shown!==""&&parseAmount(shown)===undefined;
  return <Field key={k}><FieldLabel htmlFor={`${idPrefix}-${k}`}>{metricLabels[k]}</FieldLabel><Input id={`${idPrefix}-${k}`} inputMode="decimal" value={shown} placeholder="未识别" aria-invalid={bad||values[k]==null||undefined}
   onChange={e=>{const v=e.target.value;setText(t=>({...t,[k]:v}));const n=parseAmount(v);onChange({...values,[k]:v===""||n===undefined?null:n});}}/></Field>;})}</fieldset>;
 return <div className="grid gap-4">{group("输出",outputFields)}{group("战略",strategyFields)}</div>;
}
