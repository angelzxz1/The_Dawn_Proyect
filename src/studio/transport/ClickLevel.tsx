"use client";

import { METRONOME_DB_RANGE } from "@/engine/audioPrefs";
import { CLICK_SOUNDS, CLICK_SOUND_LABELS, type ClickSound } from "@/engine/clickSounds";
import { ValueBar } from "@/studio/tracks/ValueBar";
import { useAudioPrefs } from "./useAudioPrefs";

const formatDb = (db: number) => `${db > 0 ? "+" : ""}${db.toFixed(1)}dB`;

/** The metronome's and count-in's level and sound, next to the
 * metronome's switch. Settings of this computer, like headphones' volume,
 * not of the project. */
export function ClickLevel() {
  const [prefs, update] = useAudioPrefs();
  return (
    <div className="flex items-center gap-1.5">
      <select
        aria-label="Click sound"
        title="The metronome's and count-in's sound"
        value={prefs.metronomeSound}
        onChange={(e) => update({ metronomeSound: e.target.value as ClickSound })}
        className="rounded border border-border bg-surface-raised px-1.5 py-1 text-xs text-foreground"
      >
        {CLICK_SOUNDS.map((sound) => (
          <option key={sound} value={sound}>
            {CLICK_SOUND_LABELS[sound]}
          </option>
        ))}
      </select>
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
    </div>
  );
}
