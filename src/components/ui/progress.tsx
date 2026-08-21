import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

const Progress = React.forwardRef<
  React.ComponentRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-1.5 w-full overflow-hidden bg-[#E5E5E0]",
      className
    )}
    {...props}
  >
    {/* value == null renders Radix's indeterminate state: a sliding ink segment */}
    {value == null ? (
      <ProgressPrimitive.Indicator className="progress-indeterminate absolute inset-y-0 w-1/3 bg-[#111111]" />
    ) : (
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-[#111111] transition-all duration-300 ease-out"
        style={{ transform: `translateX(-${100 - value}%)` }}
      />
    )}
  </ProgressPrimitive.Root>
))
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
