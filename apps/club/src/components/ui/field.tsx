import * as React from "react"
import { cn } from "cn"
import { Label } from "./label"

/** A form: vertical stack of Fields, at most --club-form-max wide. */
function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field-group" className={cn("flex w-full max-w-form flex-col gap-5", className)} {...props} />
}

/** One control with its label, description and error. `horizontal` puts a checkbox or radio before its text. */
function Field({ className, orientation = "vertical", ...props }: React.ComponentProps<"div"> & { orientation?: "vertical" | "horizontal" }) {
  return (
    <div
      data-slot="field"
      data-orientation={orientation}
      className={cn(orientation === "vertical" ? "flex flex-col gap-2" : "flex items-start gap-3 [&>label]:leading-normal [&>label]:text-foreground", className)}
      {...props}
    />
  )
}

function FieldLabel(props: React.ComponentProps<typeof Label>) {
  return <Label data-slot="field-label" {...props} />
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="field-description" className={cn("m-0 text-sm leading-relaxed text-muted-foreground", className)} {...props} />
}

/** Keep it rendered (empty while valid) so screen readers announce a new error. */
function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="field-error" role="alert" className={cn("m-0 rounded-sm border border-destructive bg-error-bg px-4 py-3 text-sm text-destructive empty:hidden", className)} {...props} />
}

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return <fieldset data-slot="field-set" className={cn("m-0 flex min-w-0 flex-col gap-3 border-0 p-0", className)} {...props} />
}

function FieldLegend({ className, ...props }: React.ComponentProps<"legend">) {
  return <legend data-slot="field-legend" className={cn("mb-3 p-0 text-sm font-medium text-foreground", className)} {...props} />
}

export { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet }
