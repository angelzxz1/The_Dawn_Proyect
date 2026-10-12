"use client";

import { METRONOME_DB_RANGE } from "@/engine/audioPrefs";
import { ValueBar } from "@/studio/tracks/ValueBar";
import { useAudioPrefs } from "./useAudioPrefs";

const formatDb = (db: number) => `${db > 0 ? "+" : ""}${db.toFixed(1)}dB`;

/** The metronome's and count-in's level, next to the metronome's switch.
 * A setting of this computer, like headphones' volume, not of the
 * project. */
export function ClickLevel() {
  const [prefs, update] = useAudioPrefs();
  return (
    <div title="Metronome and count-in level">
      <ValueBar
        label="Click"
        value={prefs.metronomeDb}
        min={METRONOME_DB_RANGE.min}
        max={METRONOME_DB_RANGE.max}
        defaultValue={0}
        onChange={(metronomeDb) => update({ metronomeDb })}
        formatValue={formatDb}
      />
    </div>
  );
}
