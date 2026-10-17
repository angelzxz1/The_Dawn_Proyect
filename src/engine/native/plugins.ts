// The VST3 and CLAP plugins on this computer, for the studio (desktop app
// only): the list the desktop app's scan found (bridge.ts), kept here for
// the browser to show, and read again a few times a second while a scan is
// running, so its progress shows as it goes.

import { pluginBridge, type PluginList } from "./bridge";
import { noteIssue } from "../../services/issues";

/** How often the list is read while a scan runs. */
const POLL_MS = 250;

export interface PluginsState {
  /** The last list, or null until it's first read. */
  list: PluginList | null;
  /** Why the list couldn't be read, if it couldn't. */
  error: string | null;
}

class Plugins {
  private state: PluginsState = { list: null, error: null };
  private listeners = new Set<() => void>();
  private polling = false;

  get current(): PluginsState {
    return this.state;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<PluginsState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  /** Reads the list (the desktop app scans on the first read), and keeps
   * reading it while a scan runs. */
  async refresh(): Promise<void> {
    try {
      const list = await pluginBridge.list();
      this.set({ list, error: null });
      if (list.scan) this.poll();
    } catch (error) {
      this.set({ error: String(error) });
      noteIssue("plugins.list", error);
    }
  }

  private poll(): void {
    if (this.polling) return;
    this.polling = true;
    const tick = async () => {
      await this.refresh().catch(() => undefined);
      if (this.state.list?.scan && !this.state.error) setTimeout(() => void tick(), POLL_MS);
      else this.polling = false;
    };
    setTimeout(() => void tick(), POLL_MS);
  }

  /** Scans again: for plugins installed or updated since (and, with
   * `retryFailed`, the files that couldn't be read). */
  async rescan(retryFailed = false): Promise<void> {
    try {
      await pluginBridge.scan(retryFailed);
    } catch (error) {
      noteIssue("plugins.scan", error);
    }
    await this.refresh();
  }

  /** Adds a folder to look in; rejects with why, if it can't. */
  async addFolder(path: string): Promise<void> {
    await pluginBridge.addFolder(path);
    await this.refresh();
  }

  async removeFolder(path: string): Promise<void> {
    try {
      await pluginBridge.removeFolder(path);
    } catch (error) {
      noteIssue("plugins.folder", error);
    }
    await this.refresh();
  }
}

export const plugins = new Plugins();
