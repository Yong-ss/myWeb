"use client"

import * as React from "react"
import { cn } from "cn"
import { Tabs as TabsPrimitive } from "radix-ui"
import { Reveal } from "./motion"

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
        "inline-flex min-h-11 min-w-28 cursor-pointer items-center justify-center gap-2 rounded-sm border border-border bg-transparent px-4 text-sm font-medium text-muted-foreground press-feedback transition-[background-color,border-color,color,box-shadow,scale] duration-200 ease-club-feedback hover:border-gold hover:text-gold data-[state=active]:border-gold data-[state=active]:bg-selected data-[state=active]:text-gold data-[state=active]:shadow-selected",
        className
      )}
      {...props}
    />
  )
}

/** The newly selected panel plays motion kind `content`; panels are unmounted while inactive. */
function TabsContent({ className, children, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content data-slot="tabs-content" className={cn("outline-none", className)} {...props}>
      <Reveal kind="content">{children}</Reveal>
    </TabsPrimitive.Content>
  )
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
