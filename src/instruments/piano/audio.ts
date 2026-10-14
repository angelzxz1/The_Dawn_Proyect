// How the piano's sampler is built (its samples are listed in piano.ts).

import * as Tone from "tone";
import { defineInstrumentAudio } from "../types";
import { PIANO_SAMPLE_BASE_URL, PIANO_SAMPLE_URLS } from "./piano";
import { noteIssue } from "../../services/issues";

export const pianoAudio = defineInstrumentAudio<Tone.Sampler>({
  create(_settings, onSettled) {
    return new Tone.Sampler({
      urls: PIANO_SAMPLE_URLS,
      baseUrl: PIANO_SAMPLE_BASE_URL,
      release: 1,
      attack: 0,
      onload: onSettled,
      onerror: (error) => {
        onSettled();
        noteIssue("instrument.load", error);
      },
    });
  },
});
