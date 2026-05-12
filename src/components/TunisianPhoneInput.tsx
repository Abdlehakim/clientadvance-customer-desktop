import type * as React from "react";
import { Input } from "@/components/ui/input";
import { TUNISIA_COUNTRY_CODE, formatTunisianLocalPhone } from "@/lib/tunisianPhone";
import { cn } from "@/lib/utils";

interface TunisianPhoneInputProps
  extends Omit<React.ComponentProps<typeof Input>, "type" | "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
}

export function TunisianPhoneInput({
  className,
  onChange,
  placeholder = "55 555 555",
  value,
  ...props
}: TunisianPhoneInputProps) {
  return (
    <div className="flex">
      <div className="flex h-9 shrink-0 items-center rounded-l-md border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground">
        {TUNISIA_COUNTRY_CODE}
      </div>
      <Input
        {...props}
        type="tel"
        value={value}
        placeholder={placeholder}
        inputMode="numeric"
        autoComplete="tel-national"
        maxLength={10}
        className={cn("rounded-l-none", className)}
        onChange={(event) => onChange(formatTunisianLocalPhone(event.target.value))}
      />
    </div>
  );
}
