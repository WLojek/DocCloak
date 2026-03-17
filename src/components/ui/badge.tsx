import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center border px-2.5 py-0.5 font-sans text-[10px] uppercase tracking-[0.12em] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-950 focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[#111111] text-[#F9F9F7]",
        secondary:
          "border-transparent bg-[#E5E5E0] text-[#111111]",
        destructive:
          "border-transparent bg-[#CC0000] text-[#F9F9F7]",
        outline: "text-[#111111] border-[#111111]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
