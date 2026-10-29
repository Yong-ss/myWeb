import * as React from "react"
import { cn } from "cn"
import { fieldClass } from "./input"

// A real <select>: native keyboard handling, mobile pickers and form semantics. The themed picker, option states
// and caret come from `[data-slot="native-select"]` in globals.css (appearance: base-select where supported).
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return <select data-slot="native-select" className={cn(fieldClass, "cursor-pointer", className)} {...props} />
}

function NativeSelectOption(props: React.ComponentProps<"option">) {
  return <option data-slot="native-select-option" {...props} />
}

export { NativeSelect, NativeSelectOption }
