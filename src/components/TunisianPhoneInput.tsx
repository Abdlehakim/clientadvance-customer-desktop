import type * as React from "react";
import {
  APP_INPUT_PHONE_NUMBER_CLASS_NAME,
  APP_PHONE_PREFIX_CLASS_NAME,
} from "@/components/inputStyles";
import { Input } from "@/components/ui/input";
import { TUNISIA_COUNTRY_CODE, formatTunisianLocalPhone } from "@/lib/tunisianPhone";
import { cn } from "@/lib/utils";

interface TunisianPhoneInputProps
  extends Omit<React.ComponentProps<typeof Input>, "type" | "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
  prefixClassName?: string;
}

export function TunisianPhoneInput({
  className,
  onChange,
  placeholder = "55 555 555",
  prefixClassName,
  value,
  ...props
}: TunisianPhoneInputProps) {
  return (
    <div className="flex">
      <div
        className={cn(
          APP_PHONE_PREFIX_CLASS_NAME,
          prefixClassName,
        )}
      >
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
        className={cn(className, APP_INPUT_PHONE_NUMBER_CLASS_NAME)}
        onChange={(event) => onChange(formatTunisianLocalPhone(event.target.value))}
      />
    </div>
  );
}
