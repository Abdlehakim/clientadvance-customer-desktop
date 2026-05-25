import * as React from "react";
import { createPortal } from "react-dom";

import { APP_INPUT_CLASS_NAME } from "@/components/inputStyles";
import { cn } from "@/lib/utils";

type DatePickerInputProps = {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
};

const DEFAULT_WEEKDAYS = ["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"];
const DATE_VALUE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isoDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseDateString(value: string) {
  const match = DATE_VALUE_PATTERN.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(year, month - 1, day);

  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }

  return candidate;
}

function alignViewDate(date: Date | null) {
  const nextDate = date instanceof Date ? date : new Date();

  return new Date(nextDate.getFullYear(), nextDate.getMonth(), 1);
}

function getLocale() {
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }

  return "fr-FR";
}

function formatMonth(date: Date, locale: string) {
  try {
    const text = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(date);

    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
  } catch {
    return `${date.toLocaleString(undefined, { month: "long" })} ${date.getFullYear()}`;
  }
}

function getDayLabel(date: Date, locale: string) {
  try {
    return date.toLocaleDateString(locale, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return isoDateString(date);
  }
}

function CalendarIcon() {
  return (
    <svg
      className="swb-date-picker__toggle-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      focusable="false"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 7V3m8 4V3m-11 8h14M5 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"
      />
    </svg>
  );
}

export function DatePickerInput({
  value,
  onChange,
  id,
  placeholder = "JJ-MM-YY",
  disabled = false,
  className,
  inputClassName,
}: DatePickerInputProps) {
  const generatedId = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const inputId = id;
  const panelId = `${inputId || generatedId || "swbDatePicker"}Panel`;
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const locale = React.useMemo(() => getLocale(), []);
  const selectedDate = React.useMemo(() => parseDateString(value), [value]);
  const [viewDate, setViewDate] = React.useState(() => alignViewDate(selectedDate));
  const [isOpen, setIsOpen] = React.useState(false);
  const [isMounted, setIsMounted] = React.useState(false);
  const [panelStyle, setPanelStyle] = React.useState<React.CSSProperties>({});

  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  React.useEffect(() => {
    const nextDate = parseDateString(value);

    if (nextDate) {
      setViewDate(alignViewDate(nextDate));
    }
  }, [value]);

  const closePanel = React.useCallback(() => {
    setIsOpen(false);
  }, []);

  const openPanel = React.useCallback(() => {
    if (!disabled) {
      setIsOpen(true);
    }
  }, [disabled]);

  const togglePanel = React.useCallback(() => {
    if (disabled) {
      return;
    }

    setIsOpen((open) => !open);
  }, [disabled]);

  const updatePanelPosition = React.useCallback(() => {
    const wrapper = wrapperRef.current;
    const panel = panelRef.current;

    if (!wrapper || !panel) {
      return;
    }

    const gap = 6;
    const gutter = 12;
    const wrapperRect = wrapper.getBoundingClientRect();
    const width = Math.min(320, Math.max(wrapperRect.width, 220));
    const left = Math.min(
      Math.max(wrapperRect.left, gutter),
      Math.max(gutter, window.innerWidth - width - gutter),
    );
    const panelHeight = panel.offsetHeight || 0;
    let top = wrapperRect.bottom + gap;
    let maxHeight: string | undefined;
    let overflowY: React.CSSProperties["overflowY"];

    if (panelHeight) {
      const aboveTop = wrapperRect.top - panelHeight - gap;
      const availableAbove = Math.max(0, wrapperRect.top - gap - gutter);
      const availableBelow = Math.max(0, window.innerHeight - wrapperRect.bottom - gap - gutter);
      const fitsAbove = panelHeight <= availableAbove;
      const fitsBelow = panelHeight <= availableBelow;

      if (!fitsBelow && fitsAbove) {
        top = aboveTop;
        maxHeight = availableAbove ? `${Math.round(availableAbove)}px` : undefined;
        overflowY = panelHeight > availableAbove ? "auto" : undefined;
      } else {
        top = Math.max(
          gutter,
          Math.min(top, window.innerHeight - Math.min(panelHeight, availableBelow) - gutter),
        );
        maxHeight = availableBelow ? `${Math.round(availableBelow)}px` : undefined;
        overflowY = panelHeight > availableBelow ? "auto" : undefined;
      }
    }

    setPanelStyle({
      position: "fixed",
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      width: `${Math.round(width)}px`,
      minWidth: `${Math.round(width)}px`,
      maxWidth: "320px",
      maxHeight,
      overflowY,
      zIndex: 100020,
    });
  }, []);

  React.useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    updatePanelPosition();
    const animationFrame = window.requestAnimationFrame(updatePanelPosition);
    const handleRelayout = () => updatePanelPosition();

    window.addEventListener("resize", handleRelayout);
    window.addEventListener("scroll", handleRelayout, true);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", handleRelayout);
      window.removeEventListener("scroll", handleRelayout, true);
    };
  }, [isOpen, updatePanelPosition, viewDate]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    const outsideClick = (event: MouseEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (wrapperRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }

      closePanel();
    };
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel();
      }
    };
    const focusPanel = window.requestAnimationFrame(() => {
      panelRef.current?.focus();
    });

    document.addEventListener("click", outsideClick);
    document.addEventListener("keydown", handleKeydown, true);

    return () => {
      window.cancelAnimationFrame(focusPanel);
      document.removeEventListener("click", outsideClick);
      document.removeEventListener("keydown", handleKeydown, true);
    };
  }, [closePanel, isOpen]);

  const monthLabel = formatMonth(viewDate, locale);
  const startOffset = ((viewDate.getDay() + 6) % 7) || 0;
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const todayIso = isoDateString(new Date());
  const selectedIso = selectedDate ? isoDateString(selectedDate) : "";
  const days = Array.from({ length: totalCells }, (_, index) => {
    const dayNumber = index - startOffset + 1;
    const date = new Date(viewDate.getFullYear(), viewDate.getMonth(), dayNumber);
    const isoValue = isoDateString(date);

    return { date, isoValue };
  });

  const selectDate = (date: Date, isoValue: string) => {
    setViewDate(alignViewDate(date));
    onChange(isoValue);
    closePanel();
  };

  const selectToday = () => {
    const today = new Date();

    setViewDate(alignViewDate(today));
    onChange(isoDateString(today));
    closePanel();
  };

  const clearDate = () => {
    setViewDate(alignViewDate(null));
    onChange("");
    closePanel();
  };

  const panel = (
    <div
      ref={panelRef}
      id={panelId}
      className="swb-date-picker__panel is-floating"
      data-date-picker-panel
      role="dialog"
      aria-modal="false"
      aria-label="Choisir une date"
      tabIndex={-1}
      style={panelStyle}
    >
      <div className="swb-date-picker__header">
        <button
          type="button"
          className="swb-date-picker__nav"
          aria-label="Mois precedent"
          onClick={() => setViewDate((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1))}
        >
          <span aria-hidden="true">&lt;</span>
        </button>
        <div className="swb-date-picker__month" aria-live="polite">
          {monthLabel}
        </div>
        <button
          type="button"
          className="swb-date-picker__nav"
          aria-label="Mois suivant"
          onClick={() => setViewDate((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1))}
        >
          <span aria-hidden="true">&gt;</span>
        </button>
      </div>
      <div className="swb-date-picker__weekdays">
        {DEFAULT_WEEKDAYS.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>
      <div className="swb-date-picker__grid">
        {days.map(({ date, isoValue }) => (
          <button
            key={isoValue}
            type="button"
            className={cn(
              "swb-date-picker__day",
              date.getMonth() !== viewDate.getMonth() && "is-outside",
              isoValue === todayIso && "is-today",
              selectedIso && isoValue === selectedIso && "is-selected",
            )}
            data-value={isoValue}
            aria-label={getDayLabel(date, locale)}
            onClick={() => selectDate(date, isoValue)}
          >
            {date.getDate()}
          </button>
        ))}
      </div>
      <div className="swb-date-picker__footer">
        <button type="button" className="swb-date-picker__footer-btn" onClick={selectToday}>
          Aujourd&apos;hui
        </button>
        <button
          type="button"
          className="swb-date-picker__footer-btn swb-date-picker__footer-btn--muted"
          onClick={clearDate}
        >
          Effacer
        </button>
      </div>
    </div>
  );

  return (
    <div ref={wrapperRef} className={cn("swb-date-picker", isOpen && "is-open", className)} data-date-picker>
      <input
        id={inputId}
        className={cn(APP_INPUT_CLASS_NAME, inputClassName)}
        type="text"
        inputMode="numeric"
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        value={value}
        readOnly
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={panelId}
        role="combobox"
        onClick={openPanel}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPanel();
          }

          if (event.key === "Escape") {
            event.preventDefault();
            closePanel();
          }
        }}
      />
      <button
        type="button"
        className="swb-date-picker__toggle"
        data-date-picker-toggle
        aria-label="Choisir une date"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={panelId}
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          togglePanel();
        }}
      >
        <CalendarIcon />
      </button>
      {!isOpen ? <div id={panelId} className="swb-date-picker__panel" data-date-picker-panel hidden /> : null}
      {isOpen && isMounted ? createPortal(panel, document.body) : null}
    </div>
  );
}
