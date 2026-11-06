"use client";
// Shared chrome of the import pages (roster, four-way league, highland): the step indicator and the AI prompt bar.
import type {ReactNode} from "react";
import {cn} from "cn";
import {motion} from "motion/react";
import {QuestionIcon} from "@phosphor-icons/react";
import {Button} from "./ui/button";
import {Popover,PopoverContent,PopoverTrigger} from "./ui/popover";
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from "./ui/collapsible";
import {glide,useMotion} from "./ui/motion";

export function ImportStepper({steps,step}:{steps:readonly string[];step:number}){
 const stepGlide=useMotion(glide);
 return <ol className="stepper my-2 grid list-none grid-cols-3 overflow-hidden rounded-sm border border-border bg-card p-0" aria-label="导入进度">{steps.map((label,i)=><li key={label} aria-current={i===step?"step":undefined}
  className={cn("relative flex items-center gap-3 px-5 py-4 text-sm text-muted-foreground transition-colors duration-300 max-sm:justify-center max-sm:gap-1.5 max-sm:px-2 max-sm:text-xs aria-[current=step]:text-gold",i>0&&"border-l border-divider",i<step&&"text-foreground")}>
  {i===step&&<motion.span layoutId="import-step" aria-hidden="true" className="absolute inset-0 bg-selected" transition={stepGlide}/>}
  <span className={cn("relative grid size-7 shrink-0 place-items-center rounded-sm border border-border font-heading text-xs transition-colors duration-300 max-sm:size-6",i<=step&&"border-brass text-gold")}>{i<step?"✓":String(i+1).padStart(2,"0")}</span><span className="relative">{label}</span></li>)}</ol>;
}

/** Copy-prompt button, a help popover with the how-to steps and the full prompt, and the AI hint. */
export function PromptBar({prompt,onCopy,howTo}:{prompt:string;onCopy:()=>void;howTo:ReactNode}){
 return <div className="flex flex-wrap items-center gap-3">
  <Button variant="secondary" onClick={onCopy}>复制AI识别提示词</Button>
  <Popover><PopoverTrigger asChild><Button variant="secondary" size="icon" aria-label="查看截图识别方法"><QuestionIcon/></Button></PopoverTrigger>
   <PopoverContent className="flex flex-col gap-3"><h3 className="m-0 text-lg">怎么导入？</h3><ol className="m-0 grid gap-1 pl-5 text-sm leading-relaxed">{howTo}</ol><a className="text-sm text-gold" href="https://www.doubao.com/chat/" target="_blank" rel="noopener noreferrer">打开豆包 ↗</a>
    <Collapsible><CollapsibleTrigger className="-mx-3 w-[calc(100%+1.5rem)]">完整AI识别提示词</CollapsibleTrigger><CollapsibleContent><pre className="prompt m-0 mt-2 max-h-60 overflow-y-auto rounded-sm border border-border bg-field p-4 text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{prompt}</pre></CollapsibleContent></Collapsible>
   </PopoverContent>
  </Popover>
  <p className="m-0 text-xs text-muted-foreground">* 建议使用<a className="text-muted-foreground" href="https://www.doubao.com/chat/" target="_blank" rel="noopener noreferrer">豆包</a>，选择「专家」。</p>
 </div>;
}
