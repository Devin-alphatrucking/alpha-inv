import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The phone's own dropdown (best for long lists and for people on touch screens), styled exactly like the text input:
 * 44px high on a phone, 40px on larger screens, 16px text on a phone, the same radius, border and focus ring.
 * Width is left to the layout around it; pass `className="w-auto"` or `"w-full"` as needed.
 */
const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(function NativeSelect({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      data-slot="native-select"
      className={cn(
        "h-11 min-w-0 appearance-none rounded-xl border border-input bg-background bg-[length:1rem] bg-[right_0.875rem_center] bg-no-repeat py-2 pr-10 pl-3.5 text-base shadow-xs transition-[color,box-shadow,border-color] outline-none",
        // the chevron (a data-uri so no extra request); dark mode uses a light one
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>')]",
        "hover:border-foreground/20",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        "md:h-10 md:text-sm",
        "dark:bg-input/30 dark:hover:bg-input/40 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
})

export { NativeSelect }
