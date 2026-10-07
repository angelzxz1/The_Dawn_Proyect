// The arrangement's right-click menus: on a clip, on an empty spot of a
// track's lane, and on a track's header. Each is built from where it was
// opened and what the studio can do there (MenuActions).

import {
  ChevronsDownUp,
  Clipboard,
  Copy,
  CopyPlus,
  Download,
  FileAudio,
  FilePlus2,
  FolderInput,
  FolderOutput,
  FolderPlus,
  Pencil,
  Repeat,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import { audioEngine } from "@/engine/audioEngine";
import { getCopiedClip } from "@/lib/clipboard";
import type { ChannelConfig, ClipInstance } from "@/lib/types";
import type { ContextMenuItem } from "../ContextMenu";

export type ContextMenuState =
  | { kind: "clip"; channelId: string; clipId: string; x: number; y: number }
  | { kind: "lane"; channelId: string; x: number; y: number; atSeconds: number }
  | { kind: "header"; channelId: string; x: number; y: number };

type MenuItems = (ContextMenuItem | "separator")[];

export interface MenuActions {
  editClip: (channelId: string, clipId: string) => void;
  copyClip: (channelId: string, clipId: string) => void;
  /** Pastes the copied clip over this one. */
  pasteOver: (channelId: string, clipId: string) => void;
  exportClipMidi: (channelId: string, clipId: string) => void;
  splitAtPlayhead: (channelId: string, clipId: string) => void;
  toggleLoop: (channelId: string, clipId: string) => void;
  duplicateSelected: () => void;
  deleteSelected: () => void;
  addEmptyClip: (channelId: string, atSeconds: number) => void;
  importAudio: (channelId: string, atSeconds: number) => void;
  /** Pastes the copied clip on the lane at the nearest bar. */
  pasteAt: (channelId: string, atSeconds: number) => void;
  groupTracks: (ids: string[]) => void;
  setTrackGroup: (id: string, groupId: string | null) => void;
  toggleFold: (id: string) => void;
  /** Removes a track (ungroups a group). */
  removeTrack: (id: string) => void;
}

export interface MenuContext {
  channels: ChannelConfig[];
  clipsOf: (channelId: string) => ClipInstance[];
  /** How many clips are selected (the menu acts on all of them). */
  selectedClips: number;
  /** Tracks Ctrl/Cmd-clicked for grouping. */
  trackPicks: ReadonlySet<string>;
}

export function contextMenuItems(menu: ContextMenuState, ctx: MenuContext, actions: MenuActions): MenuItems {
  const typeOf = (id: string) => ctx.channels.find((c) => c.id === id)?.type ?? "midi";
  const copied = getCopiedClip();
  const canPaste = (channelId: string) => !!copied && copied.kind === typeOf(channelId);
  if (menu.kind === "clip") return clipMenu(menu.channelId, menu.clipId, ctx, actions, canPaste(menu.channelId));
  if (menu.kind === "lane") return laneMenu(menu.channelId, menu.atSeconds, typeOf(menu.channelId), actions, canPaste(menu.channelId));
  return headerMenu(menu.channelId, ctx, actions);
}

function clipMenu(channelId: string, clipId: string, ctx: MenuContext, actions: MenuActions, canPaste: boolean): MenuItems {
  const clip = ctx.clipsOf(channelId).find((c) => c.id === clipId);
  if (!clip) return [];
  const hasNotes = clip.kind === "midi" && clip.notes.length > 0;
  const t = audioEngine.getTransportSeconds();
  const canSplit = t > clip.offset && t < clip.offset + clip.length;
  const many = ctx.selectedClips > 1;
  const copyPaste: MenuItems = [
    { label: "Copy clip", icon: <Copy size={13} />, onSelect: () => actions.copyClip(channelId, clipId) },
    { label: "Paste clip here", icon: <Clipboard size={13} />, disabled: !canPaste, onSelect: () => actions.pasteOver(channelId, clipId) },
    "separator",
  ];
  const tail: MenuItems = [
    { label: "Split at playhead", icon: <Scissors size={13} />, disabled: !canSplit, onSelect: () => actions.splitAtPlayhead(channelId, clipId) },
    { label: many ? `Duplicate ${ctx.selectedClips} clips` : "Duplicate clip", icon: <CopyPlus size={13} />, onSelect: actions.duplicateSelected },
    { label: clip.loopLength ? "Stop looping clip" : "Loop clip", icon: <Repeat size={13} />, onSelect: () => actions.toggleLoop(channelId, clipId) },
    "separator",
    { label: many ? `Delete ${ctx.selectedClips} clips` : "Delete clip", icon: <Trash2 size={13} />, danger: true, onSelect: actions.deleteSelected },
  ];
  if (clip.kind === "audio") return [...copyPaste, ...tail];
  return [
    { label: "Edit in piano roll", icon: <Pencil size={13} />, onSelect: () => actions.editClip(channelId, clipId) },
    "separator",
    ...copyPaste,
    { label: "Export .mid", icon: <Download size={13} />, disabled: !hasNotes, onSelect: () => actions.exportClipMidi(channelId, clipId) },
    ...tail,
  ];
}

function laneMenu(channelId: string, atSeconds: number, type: ChannelConfig["type"], actions: MenuActions, canPaste: boolean): MenuItems {
  // A group's lane holds no clips.
  if (type === "group") return [];
  return [
    type === "midi"
      ? { label: "Add empty MIDI clip here", icon: <FilePlus2 size={13} />, onSelect: () => actions.addEmptyClip(channelId, atSeconds) }
      : { label: "Import audio clip here…", icon: <FileAudio size={13} />, onSelect: () => actions.importAudio(channelId, atSeconds) },
    { label: "Paste clip here", icon: <Clipboard size={13} />, disabled: !canPaste, onSelect: () => actions.pasteAt(channelId, atSeconds) },
  ];
}

function headerMenu(id: string, ctx: MenuContext, actions: MenuActions): MenuItems {
  const { channels, trackPicks } = ctx;
  const channel = channels.find((c) => c.id === id);
  if (!channel) return [];
  const isGroup = channel.type === "group";
  // New clips go after what's already on the track.
  const end = ctx.clipsOf(id).reduce((max, c) => Math.max(max, c.offset + c.length), 0);
  const clipItems: ContextMenuItem[] = isGroup
    ? []
    : channel.type === "midi"
      ? [{ label: "Add empty MIDI clip", icon: <FilePlus2 size={13} />, onSelect: () => actions.addEmptyClip(id, end) }]
      : [{ label: "Import audio clip…", icon: <FileAudio size={13} />, onSelect: () => actions.importAudio(id, end) }];
  // Grouping: the Ctrl/Cmd-clicked tracks (with this one), or this one.
  const picked = trackPicks.has(id) ? [...trackPicks] : [id];
  const groups = channels.filter((c) => c.type === "group" && c.id !== channel.groupId);
  const groupItems: ContextMenuItem[] = isGroup
    ? [{ label: "Ungroup (keep the tracks)", icon: <FolderOutput size={13} />, onSelect: () => actions.removeTrack(id) }]
    : [
        {
          label: picked.length > 1 ? `Group ${picked.length} tracks (Ctrl+G)` : "Group this track (Ctrl+G)",
          icon: <FolderPlus size={13} />,
          onSelect: () => actions.groupTracks(picked),
        },
        ...groups.map((g) => ({ label: `Move into “${g.name}”`, icon: <FolderInput size={13} />, onSelect: () => actions.setTrackGroup(id, g.id) })),
        ...(channel.groupId ? [{ label: "Take out of the group", icon: <FolderOutput size={13} />, onSelect: () => actions.setTrackGroup(id, null) }] : []),
      ];
  const foldItem: ContextMenuItem = {
    label: channel.folded ? (isGroup ? "Unfold the group" : "Unfold track") : isGroup ? "Fold the group (hide its tracks)" : "Fold track",
    icon: <ChevronsDownUp size={13} />,
    onSelect: () => actions.toggleFold(id),
  };
  const removeItems: MenuItems =
    channels.length > 1 && !isGroup
      ? ["separator", { label: "Remove track", icon: <X size={13} />, danger: true, onSelect: () => actions.removeTrack(id) }]
      : [];
  return [...clipItems, ...(clipItems.length ? ["separator" as const] : []), ...groupItems, foldItem, ...removeItems];
}
