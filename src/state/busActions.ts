// What you can do to a send/return bus: add, rename, remove. Each is one
// undo step. (Its effects are effectActions'; a track's send level to it
// is trackActions.setSend.)

import { audioEngine } from "@/lib/audioEngine";
import { newBusId } from "./ids";
import { projectStore } from "./projectStore";

export const busActions = {
  /** Adds "Bus N"; returns its id. */
  add(): string {
    projectStore.push();
    const id = newBusId();
    projectStore.set("buses", (prev) => [...prev, { id, name: `Bus ${prev.length + 1}`, colorIndex: prev.length }]);
    return id;
  },

  rename(id: string, name: string): void {
    projectStore.push();
    projectStore.set("buses", (prev) => prev.map((b) => (b.id === id ? { ...b, name } : b)));
  },

  /** Removes a bus with its effects, and every track's send to it. */
  remove(id: string): void {
    projectStore.push();
    audioEngine.removeBus(id);
    projectStore.set("buses", (prev) => prev.filter((b) => b.id !== id));
    projectStore.set("busEffects", (prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    projectStore.set("channels", (prev) =>
      prev.map((c) => {
        if (!c.sends || !(id in c.sends)) return c;
        const sends = { ...c.sends };
        delete sends[id];
        return { ...c, sends };
      })
    );
  },
};
