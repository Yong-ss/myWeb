"use client"

import * as React from "react"
import { cn } from "cn"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"
import { AnimatePresence, motion } from "motion/react"

import { useMotionKind, useOpen, withOpenState } from "./motion"
import type { AnchoredProps } from "./popover"

// A list of actions behind one trigger (arrow keys, typeahead, Escape). Not for navigation or form choices:
// use links for pages and NativeSelect/RadioGroup for values.
const DropdownMenu = withOpenState(DropdownMenuPrimitive.Root, "dropdown-menu")
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
const DropdownMenuGroup = DropdownMenuPrimitive.Group

function DropdownMenuContent({ className, align = "end", sideOffset = 6, children, ...props }: AnchoredProps) {
  const open = useOpen()
  const animation = useMotionKind("menu")
  return (
    <AnimatePresence>
      {open && (
        <DropdownMenuPrimitive.Portal forceMount>
          <DropdownMenuPrimitive.Content asChild forceMount align={align} sideOffset={sideOffset} collisionPadding={16} {...props}>
            <motion.div
              data-slot="dropdown-menu-content"
              className={cn(
                "z-(--club-z-overlay) min-w-44 origin-(--radix-dropdown-menu-content-transform-origin) rounded-sm border border-brass bg-popover p-1 text-popover-foreground shadow-overlay outline-none data-[state=closed]:pointer-events-none",
                className
              )}
              {...animation}
            >
              {children}
            </motion.div>
          </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Portal>
      )}
    </AnimatePresence>
  )
}

function DropdownMenuItem({ className, variant = "default", ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { variant?: "default" | "destructive" }) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-3 text-sm outline-none select-none transition-[background-color,color,padding] ease-club-feedback data-[highlighted]:pl-4 motion-reduce:data-[highlighted]:pl-3 data-[disabled]:cursor-not-allowed data-[disabled]:text-disabled-foreground data-[highlighted]:bg-hover data-[highlighted]:text-gold data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-error-bg data-[variant=destructive]:data-[highlighted]:text-destructive [&_svg]:size-4 [&_svg]:shrink-0",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label data-slot="dropdown-menu-label" className={cn("eyebrow px-3 py-2", className)} {...props} />
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator data-slot="dropdown-menu-separator" className={cn("-mx-1 my-1 h-px bg-divider", className)} {...props} />
}

export { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger }
