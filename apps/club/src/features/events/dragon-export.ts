import {pathways} from "../../lib/pathways.ts";
type Player={display_name:string;pathway?:string|null};
export type DragonReport={club_name:string;event:{event_date:string;status:string;version:number};players:Player[];roster?:{date:string;revision:number;complete:boolean}|null;absent?:Player[]};
const escape=(s:string)=>s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
export function dragonReportRows(data:DragonReport){
 const {event:e}=data;
 const note=e.status!=="active"?"已作废，不计入出勤；不判断未参加名单。":!data.roster?"没有可用的当天成员名单，无法判断未参加者。":`按 ${data.roster.date} 当天第 ${data.roster.revision} 版名单核对${data.roster.complete?"":"；名单不完整，只列出已录入成员"}。`;
 const rows=[[`${data.club_name} · ${e.event_date} 猎龙出勤报表`],[`记录${e.status==="active"?"有效":"已作废"} · 第 ${e.version} 版 · 参加 ${data.players.length} 人`],[note],["出勤","玩家","途径"]];
 const add=(label:string,players:Player[])=>[...players].sort((a,b)=>(a.pathway??"").localeCompare(b.pathway??"","zh-CN")||a.display_name.localeCompare(b.display_name,"zh-CN")).forEach(p=>rows.push([label,p.display_name,p.pathway||"未识别途径"]));
 add("参加",data.players);
 if(e.status==="active"&&data.roster)add("未参加",data.absent??[]);
 return rows;
}
// A small, uncompressed ZIP package keeps this export dependency-free.
function workbookZip(files:Record<string,string>){
 const encoder=new TextEncoder(),local:Uint8Array[]=[],central:Uint8Array[]=[];
 let offset=0;
 const header=(size:number)=>new Uint8Array(size);
 for(const [path,xml] of Object.entries(files)){
  const name=encoder.encode(path),body=encoder.encode(xml);
  let crc=0xffffffff;
  for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  crc=(crc^0xffffffff)>>>0;
  const entry=header(30),view=new DataView(entry.buffer);
  view.setUint32(0,0x04034b50,true);view.setUint16(4,20,true);view.setUint16(12,33,true);
  view.setUint32(14,crc,true);view.setUint32(18,body.length,true);view.setUint32(22,body.length,true);view.setUint16(26,name.length,true);
  const directory=header(46),dv=new DataView(directory.buffer);
  dv.setUint32(0,0x02014b50,true);dv.setUint16(4,20,true);dv.setUint16(6,20,true);dv.setUint16(14,33,true);
  dv.setUint32(16,crc,true);dv.setUint32(20,body.length,true);dv.setUint32(24,body.length,true);dv.setUint16(28,name.length,true);dv.setUint32(42,offset,true);
  local.push(entry,name,body);central.push(directory,name);offset+=entry.length+name.length+body.length;
 }
 const size=central.reduce((n,p)=>n+p.length,0),end=header(22),ev=new DataView(end.buffer),count=Object.keys(files).length;
 ev.setUint32(0,0x06054b50,true);ev.setUint16(8,count,true);ev.setUint16(10,count,true);ev.setUint32(12,size,true);ev.setUint32(16,offset,true);
 const result=new Uint8Array(offset+size+22);let cursor=0;
 for(const part of [...local,...central,end]){result.set(part,cursor);cursor+=part.length;}
 return result;
}
export function dragonExcelColumns(data:DragonReport){
 const groups=new Map<string,Player[]>(Object.keys(pathways).map(name=>[name,[]]));
 for(const player of data.players){const name=player.pathway?.trim()||"未识别途径";if(!groups.has(name))groups.set(name,[]);groups.get(name)!.push(player);}
 const columns=[...groups].map(([name,players])=>({name,players}));
 columns.push({name:"未参加",players:data.event.status==="active"&&data.roster?data.absent??[]:[]});
 return columns.map(c=>({...c,players:[...c.players].sort((a,b)=>a.display_name.localeCompare(b.display_name,"zh-CN"))}));
}
function excelColumn(index:number):string{return index<26?String.fromCharCode(65+index):excelColumn(Math.floor(index/26)-1)+String.fromCharCode(65+index%26);}
export function dragonExcel(data:DragonReport,colors:Record<string,string>={}){
 const ns="http://schemas.openxmlformats.org/spreadsheetml/2006/main",rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships";
 const columns=dragonExcelColumns(data),last=excelColumn(columns.length-1);
 const rows=dragonReportRows(data).slice(0,3);
 rows.push(columns.map(c=>`${c.name} · ${c.players.length} 人`));
 for(let i=0;i<Math.max(0,...columns.map(c=>c.players.length));i++)rows.push(columns.map(c=>c.players[i]?.display_name??""));
 const accents=columns.map(c=>/^#[0-9a-f]{6}$/i.test(colors[c.name]??"")?colors[c.name].slice(1).toUpperCase():"D4D4D4");
 const tint=(hex:string)=>hex.match(/../g)!.map(v=>Math.round(parseInt(v,16)*0.14+255*0.86).toString(16).padStart(2,"0")).join("").toUpperCase();
 return workbookZip({
  "[Content_Types].xml":`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  "_rels/.rels":`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  "xl/workbook.xml":`<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="猎龙出勤" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels":`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
  "xl/styles.xml":`<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="10"/><name val="Microsoft YaHei"/></font><font><b/><sz val="14"/><name val="Microsoft YaHei"/></font></fonts><fills count="${3+columns.length*2}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEE8DD"/><bgColor indexed="64"/></patternFill></fill>${accents.map(color=>[color,tint(color)].map(c=>`<fill><patternFill patternType="solid"><fgColor rgb="FF${c}"/><bgColor indexed="64"/></patternFill></fill>`).join("")).join("")}</fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="${3+columns.length*2}"><xf fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" shrinkToFit="1"/></xf><xf fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" shrinkToFit="1"/></xf><xf fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>${columns.map((_,j)=>[0,1].map(k=>`<xf fontId="0" fillId="${3+j*2+k}" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="center" shrinkToFit="1"/></xf>`).join("")).join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  "xl/worksheets/sheet1.xml":`<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="${columns.length}" width="20" customWidth="1"/></cols><sheetData>${rows.map((r,i)=>`<row r="${i+1}" ht="${i===0?28:i===2?30:i===3?22:18}" customHeight="1">${r.map((v,j)=>`<c r="${excelColumn(j)}${i+1}" t="inlineStr" s="${i===0?1:i===2?2:i<3?0:3+j*2+(i===3?0:1)}"><is><t xml:space="preserve">${escape(v)}</t></is></c>`).join("")}</row>`).join("")}</sheetData><mergeCells count="3"><mergeCell ref="A1:${last}1"/><mergeCell ref="A2:${last}2"/><mergeCell ref="A3:${last}3"/></mergeCells><pageSetup paperSize="9" orientation="landscape"/></worksheet>`,
 });
}
export function dragonPrint(data:DragonReport,colors:Record<string,string>={}){
 const [title,summary,note]=dragonReportRows(data),columns=dragonExcelColumns(data);
 const color=(name:string)=>name!=="未参加"&&/^#[0-9a-f]{6}$/i.test(colors[name]??"")?colors[name]:"#d4d4d4";
 const count=(name:string,n:number)=>name==="未参加"&&(data.event.status!=="active"||!data.roster)?"无法判断":`${n} 人`;
 const body=Array.from({length:Math.max(1,...columns.map(c=>c.players.length))},(_,i)=>`<tr>${columns.map(c=>`<td style="--accent:${color(c.name)}">${escape(c.players[i]?.display_name??"")}</td>`).join("")}</tr>`).join("");
 return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escape(title[0])}</title><style>
 *{box-sizing:border-box}body{font:12px/1.4 "Microsoft YaHei",system-ui,sans-serif;color:#252525;margin:24px auto;padding:0 24px;max-width:1400px}
 h1{font-size:24px;letter-spacing:1px;margin:0;padding-bottom:10px;border-bottom:2px solid #997b48}p{margin:8px 0;color:#555}.summary{font-weight:600;color:#333}.note{font-size:11px}
 .report{min-width:960px}table{table-layout:fixed;width:100%;border-collapse:collapse;margin:16px 0}th{text-align:left;background:var(--accent);padding:8px;font-size:13px}th span{display:block;font-size:11px;font-weight:400;margin-top:2px}
 td{background:color-mix(in srgb,var(--accent) 14%,white);height:24px;padding:3px 8px;vertical-align:top;border-bottom:1px solid #e5e5e5}td,th{border-right:2px solid white;overflow-wrap:anywhere}tr{break-inside:avoid}thead{display:table-header-group}
 button{min-height:44px;padding:8px 16px;margin-bottom:16px;cursor:pointer}button:focus-visible{outline:2px solid #997b48;outline-offset:2px}
 @page{size:A4 landscape;margin:10mm}@media print{body{margin:0;padding:0;max-width:none;font-size:9pt;print-color-adjust:exact;-webkit-print-color-adjust:exact}.report{min-width:0}h1{font-size:18pt}button{display:none}td{height:18pt}th{font-size:10pt}th span,.note{font-size:8pt}}
 </style><button onclick="window.print()">打印 / 保存 PDF</button><main class="report"><h1>${escape(title[0])}</h1><p class="summary">${escape(summary[0])}</p><p class="note">${escape(note[0])}</p><table aria-label="按途径分列的猎龙出勤"><thead><tr>${columns.map(c=>`<th scope="col" style="--accent:${color(c.name)}">${escape(c.name)}<span>${count(c.name,c.players.length)}</span></th>`).join("")}</tr></thead><tbody>${body}</tbody></table></main></html>`;
}
