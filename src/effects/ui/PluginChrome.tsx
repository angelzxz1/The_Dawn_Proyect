"use client";

import { Maximize2, Power, X } from "lucide-react";
import { PluginIcon } from "./PluginIcon";
import { fraunces, spaceGrotesk } from "./pluginFonts";
import { WindowPresetMenu } from "./PresetMenu";

/** The top row of a compact FX rack card: icon, name, a short status, and
 * expand / bypass / remove. */
export function RackCardHeader({
  title,
  status,
  bypass,
  onBypassToggle,
  onRemove,
  onExpand,
}: {
  title: string;
  status?: React.ReactNode;
  bypass: boolean;
  onBypassToggle: () => void;
  onRemove: () => void;
  onExpand: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex min-w-0 items-center gap-1.5">
        <PluginIcon size={15} />
        <h2 className={`${fraunces.className} text-[13px] font-semibold text-[#F4EDE2]`}>{title}</h2>
        {status !== undefined && (
          <span className={`${spaceGrotesk.className} truncate text-[10px] font-semibold uppercase tracking-wider text-muted`}>{status}</span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button type="button" title="Expand" onClick={onExpand} className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-black/20">
          <Maximize2 size={11} />
        </button>
        <button
          type="button"
          title={bypass ? "Enable effect" : "Bypass effect"}
          onClick={onBypassToggle}
          className="flex h-5 w-5 items-center justify-center rounded"
          style={{ background: "#23242B", border: "1px solid #2E2F37" }}
        >
          <Power size={11} color={bypass ? "#5A5B64" : "#E6AD5E"} />
        </button>
        <button type="button" title="Remove effect" onClick={onRemove} className="flex h-5 w-5 items-center justify-center rounded text-record hover:bg-black/20">
          <X size={11} />
        </button>
      </div>
    </div>
  );
}

/** A plugin's full window: the dimmed backdrop, the panel with its title
 * row (bypass, close), and the content. Escape closes it. */
export function PluginWindow({
  title,
  channelName,
  bypass,
  onBypassToggle,
  onClose,
  width,
  children,
}: {
  title: string;
  channelName: string;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  width: number;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className={`${spaceGrotesk.className} flex max-w-full flex-col gap-4 rounded-2xl shadow-2xl`}
        style={{ width, background: "#1B1C22", border: "1px solid #2E2F37", padding: "18px 22px 20px" }}
        role="dialog"
        aria-label={title}
      >
        <div className="flex h-[30px] items-center justify-between">
          <div className="flex items-center gap-2">
            <PluginIcon />
            <h2 className={`${fraunces.className} text-[19px] font-semibold text-[#F4EDE2]`} style={{ letterSpacing: "-0.2px" }}>
              {title}
            </h2>
            <span className="text-xs text-muted">— {channelName}</span>
            <div className="ml-3">
              <WindowPresetMenu />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title={bypass ? "Enable effect" : "Bypass effect"}
              onClick={onBypassToggle}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-lg"
              style={{ background: "#23242B", border: "1px solid #2E2F37" }}
            >
              <Power size={16} color={bypass ? "#5A5B64" : "#E6AD5E"} />
            </button>
            <button type="button" title="Close" onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center rounded-lg">
              <X size={14} color="#9A9AA4" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/** An on/off pill button for a plugin setting. */
export function PluginToggle({
  label,
  active,
  onClick,
  title,
  danger = false,
  small = false,
}: {
  label: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title?: string;
  danger?: boolean;
  small?: boolean;
}) {
  const on = danger ? "#FF6B6B" : "#E6AD5E";
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={`whitespace-nowrap rounded-md font-bold uppercase tracking-wide ${small ? "px-1.5 py-0.5 text-[9.5px]" : "px-2.5 py-1 text-[11px]"}`}
      style={
        active
          ? { background: danger ? "rgba(255,107,107,0.16)" : "rgba(230,173,94,0.18)", color: on, border: `1px solid ${on}` }
          : { color: "#9A9AA4", border: "1px solid #2E2F37" }
      }
    >
      {label}
    </button>
  );
}
