"use client"

import * as React from "react"
import { cn } from "cn"
import { Collapsible as CollapsiblePrimitive } from "radix-ui"
import { AnimatePresence, motion } from "motion/react"
import { CaretRightIcon } from "@phosphor-icons/react"

import { useMotionKind, useOpen, withOpenState } from "./motion"

// Show/hide a section in place (replaces <details>). The panel's height and opacity animate together, so content
// below slides instead of jumping; the content unmounts when closed, so keep form values in the parent's state.
const Collapsible = withOpenState(CollapsiblePrimitive.Root, "collapsible")

/** The default trigger: a full-width row with a caret that turns when open. Pass `asChild` for a custom trigger. */
function CollapsibleTrigger({ className, children, asChild, ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
  if (asChild) return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" asChild {...props}>{children}</CollapsiblePrimitive.Trigger>
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        "group/trigger flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-muted-foreground transition-[background-color,color] ease-club-feedback hover:bg-hover active:bg-pressed active:duration-0 hover:text-gold data-[state=open]:text-foreground",
        className
      )}
      {...props}
    >
      <CaretRightIcon aria-hidden="true" className="size-4 shrink-0 text-gold transition-transform duration-300 ease-club-enter group-data-[state=open]/trigger:rotate-90" />
      {children}
    </CollapsiblePrimitive.Trigger>
  )
}

function CollapsibleContent({ className, children, onExpandUpdate, ...props }: Omit<React.ComponentProps<typeof CollapsiblePrimitive.Content>, "asChild" | "forceMount"> & { onExpandUpdate?: () => void }) {
  const open = useOpen()
  const panel=React.useRef<HTMLDivElement>(null)
  const expanding=React.useRef(false)
  React.useEffect(()=>{
    if(!open||!onExpandUpdate||!panel.current)return
    const observer=new ResizeObserver(()=>{ if(expanding.current)onExpandUpdate() })
    observer.observe(panel.current)
    return ()=>observer.disconnect()
  },[open,onExpandUpdate])
  const panelMotion = useMotionKind("collapse"), contentMotion = useMotionKind("collapseContent")
  return (
    <AnimatePresence initial={false}>
      {open && (
        <CollapsiblePrimitive.Content asChild forceMount {...props}>
          <motion.div
            ref={panel}
            data-slot="collapsible-content"
            className="overflow-hidden"
            {...panelMotion}
            onAnimationStart={() => { expanding.current=open }}
            onAnimationComplete={() => { expanding.current=false; if (open) onExpandUpdate?.() }}
          >
            {/* Content fades in just after the panel starts opening and fades out first when closing. */}
            <motion.div className={className} {...contentMotion}>{children}</motion.div>
          </motion.div>
        </CollapsiblePrimitive.Content>
      )}
    </AnimatePresence>
  )
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger }
