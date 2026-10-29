"use client"

import * as React from "react"
import { cn } from "cn"
import { Tabs as TabsPrimitive } from "radix-ui"
import { motion } from "motion/react"

import { ease, useMotion } from "./motion"

// Switch between alternative views of the same task (e.g. paste vs. upload). Arrow keys move between tabs.
const Tabs = TabsPrimitive.Root

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List data-slot="tabs-list" className={cn("inline-flex w-fit flex-wrap gap-2", className)} {...props} />
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex min-h-11 min-w-28 cursor-pointer items-center justify-center gap-2 rounded-sm border border-border bg-transparent px-4 text-sm font-medium text-muted-foreground transition-[background-color,border-color,color,box-shadow,scale] duration-200 ease-club-feedback active:scale-[0.98] active:duration-75 hover:border-gold hover:text-gold data-[state=active]:border-gold data-[state=active]:bg-selected data-[state=active]:text-gold data-[state=active]:shadow-[inset_0_0_0_1px_var(--club-border-strong)]",
        className
      )}
      {...props}
    />
  )
}

/** The newly selected panel fades and rises 4px into place; panels are unmounted while inactive. */
function TabsContent({ className, children, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  const fade = useMotion({ duration: 0.24, ease: ease.enter })
  return (
    <TabsPrimitive.Content data-slot="tabs-content" className={cn("outline-none", className)} {...props}>
      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0, transition: fade }}>{children}</motion.div>
    </TabsPrimitive.Content>
  )
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
