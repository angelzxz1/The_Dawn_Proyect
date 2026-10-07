"use client";

/** A row of mutually exclusive options (a radio group styled as a
 * segmented control), used across the plugin windows. */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="flex gap-0.5 rounded-lg p-0.5" style={{ border: "1px solid #2E2F37" }} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => !on && onSelect(o.value)}
            className="whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
            style={{ background: on ? "#2E2F37" : "transparent", color: on ? "#F4EDE2" : "#8A8A94" }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
