import * as React from "react"
import { cn } from "cn"
import { fieldClass } from "./input"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(fieldClass, "min-h-32 p-4 font-mono leading-relaxed md:text-sm", className)} {...props} />
}

export { Textarea }
