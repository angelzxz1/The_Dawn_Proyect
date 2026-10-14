"use client";

import { useEffect, useRef } from "react";
import { Pipette } from "lucide-react";

/** "Any color": opens the system color picker. The color is applied once
 * it's chosen (not on every step of dragging around the picker), so it's
 * one undo step. */
export function CustomColorButton({ value, onPick }: { value: string; onPick: (hex: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  });
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const onChange = () => pick.current(el.value.toLowerCase());
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);
  return (
    <label
      title="Any color…"
      onClick={(e) => e.stopPropagation()}
      className="relative flex h-4 w-full cursor-pointer items-center justify-center gap-1 rounded-full text-[9px] text-muted ring-1 ring-border hover:text-foreground hover:ring-white/60"
      style={{ background: "conic-gradient(from 0deg, #ff5a5a, #ffe45e, #8ee27d, #5eb1ff, #e37dff, #ff5a5a)" }}
    >
      <span className="flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 leading-none text-white">
        <Pipette size={8} /> Any color
      </span>
      <input ref={input} type="color" defaultValue={/^#[0-9a-f]{6}$/i.test(value) ? value : "#5eb1ff"} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Pick any color" />
    </label>
  );
}
