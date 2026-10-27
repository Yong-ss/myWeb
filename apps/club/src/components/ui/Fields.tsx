import type { ComponentProps } from "react";
export function Input({ className = "", ...props }: ComponentProps<"input">) { return <input {...props} className={`club-field ${className}`} />; }
export function Select({ className = "", ...props }: ComponentProps<"select">) { return <select {...props} className={`club-field ${className}`} />; }

export function Textarea({ className = "", ...props }: ComponentProps<"textarea">) { return <textarea {...props} className={`club-field ${className}`} />; }
