import * as React from "react";

import {
  APP_INPUT_CLASS_NAME,
  APP_INPUT_TEXTAREA_CLASS_NAME,
} from "@/components/inputStyles";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          APP_INPUT_CLASS_NAME,
          APP_INPUT_TEXTAREA_CLASS_NAME,
          "flex disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
