// The Daybreak guide (/guides/daybreak): what every part of the synth's
// window is for and what each knob does. Ranges and defaults follow
// src/instruments/synth (synthParams.ts and SynthWindow.tsx).

import type { PresetCategory } from "@/instruments/synth/synthPresets";
import type { GuideSection } from "./guides";

export const DAYBREAK_SECTIONS: GuideSection[] = [
  {
    id: "quick-start",
    title: "Quick start",
    lead: "From an empty project to your own sound in a few minutes.",
    steps: [
      { title: "Add a MIDI track", text: "Click + MIDI under the track list. A new MIDI track opens its device rack at the bottom of the screen." },
      { title: "Load Daybreak", text: "In the rack's Instrument card, choose Synth. The card shows a small view of the sound, and the track now plays Daybreak." },
      { title: "Open the window", text: "Click the card (or its open button) to open Daybreak's full window. Press Esc or the × to close it again." },
      { title: "Pick a preset", text: "Use the arrows beside the preset name to step through the sounds, or click the name to browse them by category." },
      { title: "Play", text: "Play your MIDI controller, the computer keyboard, or notes drawn in the piano roll. The voices counter in the header lights up while notes sound." },
      { title: "Shape it and save it", text: "Turn any knob to change the sound. When you like it, click the save button, name it and pick a category." },
    ],
    tips: ["Every change is part of the project and can be undone with Ctrl/Cmd+Z.", "Start from Init when you want to build a sound from scratch: one oscillator into an open filter."],
  },
  {
    id: "signal-flow",
    title: "How the sound flows",
    nav: "Signal flow",
    lead: "Every note you play gets its own voice, and every voice runs the same path.",
    paragraphs: [
      "Four sources make the sound: two wavetable oscillators, a sub oscillator and a noise source. Each one has a To switch that sends it into Filter 1, Filter 2, both filters, or straight to the output (Out), past the filters.",
      "The two filters run one after the other (1 → 2, serial) or side by side (1 | 2, parallel). After the filters, the amp envelope (Env 1) shapes the note's loudness, and the Volume knob in the header sets the level of the whole synth.",
      "Around that path sit the modulators: three envelopes, three LFOs, velocity, the note, the mod wheel, pitch bend, a random value and four macros. Any of them can move almost any knob through the modulation matrix.",
    ],
  },
  {
    id: "knobs",
    title: "Working the knobs",
    lead: "Every knob in Daybreak works the same way.",
    groups: [
      {
        controls: [
          { name: "Drag", text: "Drag up or down to turn a knob. Scrolling over it works too." },
          { name: "Shift", text: "Hold Shift while dragging or scrolling for fine steps." },
          { name: "Click", text: "Click a knob to type an exact value." },
          { name: "Double-click", text: "Resets the knob to its default." },
          { name: "Arrow keys", text: "With a knob focused, the arrow keys nudge it (with Shift for fine steps)." },
          { name: "Right-click", text: "On a knob that can be modulated, lists its modulations so you can change their amounts or remove them." },
          { name: "Greyed out", text: "A knob is greyed out when it does nothing in the current setting, like Detune with only one unison voice." },
        ],
      },
    ],
  },
  {
    id: "header",
    title: "The header and presets",
    nav: "Header & presets",
    lead: "The strip across the top of the window: presets, the two pages, and the output.",
    groups: [
      {
        controls: [
          { name: "Preset name", text: "Shows the sound you loaded or saved. Click it to open the browser: categories on the left (All, Bass, Lead, Pad, Pluck, Keys, FX and Yours), a search box, and the list. Click a preset to load it." },
          { name: "‹ and ›", text: "Step to the previous or next preset in the list without opening the browser." },
          { name: "Save", text: "Saves the current sound under a name and category. Presets are kept in this browser; saving with the same name replaces your older one. Hover one of your presets in the browser to delete it." },
          { name: "Synth / Matrix", text: "Switches between the main page with every panel and the modulation matrix, which lists every modulation. The Matrix tab shows how many there are." },
          { name: "Voices", text: "How many notes are sounding right now." },
          { name: "Scope", text: "A live view of the synth's output wave." },
          { name: "Volume", range: "−48 to +6 dB · default −6 dB", text: "The level of the whole synth. It can be modulated too, which is how pumping pads are made." },
        ],
      },
    ],
    tips: ["To back up your presets or share them, save them as a pack from the studio's Packs window. A pack holds your effect presets, Daybreak presets and drum kits in one file."],
  },
  {
    id: "oscillators",
    title: "Oscillators",
    lead: "Osc 1 and Osc 2 are where the tone starts. Each one plays a wavetable: a series of single-cycle waves that you move through with the Position knob.",
    paragraphs: [
      "The picture on the left of each oscillator shows the wave it is playing right now, including any warp and modulation. The two oscillators work the same way; they differ only in that each one's FM and Ring warps listen to the other.",
    ],
    groups: [
      {
        title: "The oscillator's header",
        controls: [
          { name: "Power", text: "Turns the oscillator on or off." },
          { name: "Wavetable", text: "Choose the wavetable from the menu, or step through them with the arrows on either side of it. The tables are described below." },
          { name: "Import", text: "Loads your own wavetable from an audio file. The file is cut into cycles of 2048 samples, one per frame, and saved with the project." },
          { name: "To", range: "F1 · F2 · F1+2 · Out", text: "Where the oscillator goes: Filter 1, Filter 2, both filters, or straight to the output, skipping the filters." },
          { name: "Warp", range: "Off, Sync, Bend, Squeeze, Pulse, Mirror, Fold, Quantize, FM, Ring", text: "Changes how the wave is read, for new tones from the same table. The Warp knob sets how much. The modes are described below." },
        ],
      },
      {
        title: "The knobs",
        controls: [
          { name: "Position", range: "0–100% · default 50%", text: "Where in the wavetable to play. Low values play the first waves, high values the last ones. Modulating Position with an envelope or LFO is the heart of wavetable sound: the tone changes as the note plays." },
          { name: "Warp", range: "0–100%", text: "How strongly the warp mode bends the wave. Greyed out while Warp is Off." },
          { name: "Pitch", range: "−48 to +48 semitones", text: "Transposes the oscillator in semitones. +12 is an octave up, +7 a fifth up, −12 an octave down." },
          { name: "Fine", range: "−100 to +100 cents", text: "Fine tuning, in hundredths of a semitone. A few cents between the two oscillators makes them beat slowly against each other." },
          { name: "Level", range: "0–100% · default 70%", text: "How loud the oscillator is." },
          { name: "Pan", range: "Left to right", text: "Places the oscillator in the stereo field." },
          { name: "Unison", range: "1–16 voices", text: "Stacks copies of the oscillator for every note. More voices make a thicker, wider sound, and cost more processing." },
          { name: "Detune", range: "0–100% (up to ±50 cents)", text: "How far apart in pitch the unison voices spread. Low values give a gentle chorus, high values the wide supersaw sound. Needs 2 or more unison voices." },
          { name: "Blend", range: "0–100% · default 75%", text: "The level of the outer, most detuned unison voices against the middle ones. Lower it to keep the centre focused; raise it for a wider wash. Needs 3 or more voices." },
          { name: "Width", range: "0–100% · default 80%", text: "How far the unison voices spread across the stereo field. 0% keeps them in the centre. Needs 2 or more voices." },
          { name: "Phase", range: "0–360°", text: "Where in the wave each note starts." },
          { name: "Rand", range: "0–100% · default 100%", text: "How much each voice's starting point is randomized. At 100% every note sounds slightly different and unison stays smooth. Turn it down for the same punchy attack on every note, which suits basses, kicks and organs." },
        ],
      },
      {
        title: "Wavetables",
        lead: "What each built-in table holds, from the start of its Position to the end.",
        controls: [
          { name: "Basic Shapes", text: "Sine, then triangle, saw, square and a narrow pulse. The classic waves in one table." },
          { name: "Daybreak", text: "Daybreak's own: a warm, rounded saw that opens up as Position rises, then a resonant glint rises through it." },
          { name: "Harmonic Series", text: "Starts as a pure sine and adds harmonics one octave at a time until it is a full, bright saw." },
          { name: "Pulse Width", text: "A square wave that narrows to a thin pulse: hollow at first, then nasal and buzzy." },
          { name: "Analog Drift", text: "A saw whose harmonics drift out of phase, like a stack of slightly unstable analog oscillators." },
          { name: "Vowels", text: "Sung vowels: A, E, I, O, U and back to A. Sweep Position to make it talk." },
          { name: "Choir", text: "A soft choir tone moving from O to E, with a gentle top end." },
          { name: "Drawbars", text: "Organ drawbars, from one 8' drawbar up to all nine pulled out." },
          { name: "Bells", text: "Bell-like, slightly inharmonic partials that stretch out and brighten." },
          { name: "FM Sweep", text: "A sine with more and more frequency modulation: pure, then electric-piano, then metallic." },
          { name: "FM Octaves", text: "FM an octave up: hollower and brighter than FM Sweep." },
          { name: "Hard Sync", text: "The sound of a hard-synced saw sweeping upward: the classic tearing lead." },
          { name: "Wavefolder", text: "A sine folded over on itself more and more, adding bright, buzzing harmonics." },
          { name: "Resonant Sweep", text: "A saw through a resonant low-pass filter whose cutoff rises with Position." },
          { name: "Growl", text: "A moving vocal peak and shifting odd harmonics: the talking bass of dubstep and riddim." },
          { name: "Bitcrush", text: "A wave with fewer and fewer samples and bits: clean, then crunchy and lo-fi." },
          { name: "Glitch", text: "Random spectra, from sparse to dense. Every position is a different digital texture." },
        ],
      },
      {
        title: "Warp modes",
        lead: "Each warp bends how the oscillator reads its wave. The Warp knob sets how far.",
        controls: [
          { name: "Sync", text: "Reads the wave up to 16 times per cycle while keeping the note's pitch, like a hard-synced oscillator. Sweep it for tearing leads." },
          { name: "Bend", text: "Rushes through the start of the wave and slows at the end, shifting its harmonics." },
          { name: "Squeeze", text: "Pinches both halves of the wave toward the middle, for a sharper, more nasal tone." },
          { name: "Pulse", text: "Plays the whole wave in a shrinking part of the cycle and stays silent for the rest, like pulse-width modulation on any wave." },
          { name: "Mirror", text: "Reads the wave forward, then backward. At 100% the wave is symmetrical: softer, with fewer even harmonics." },
          { name: "Fold", text: "Drives the wave and folds its peaks back down, adding bright harmonics. Good for aggressive basses and leads." },
          { name: "Quantize", text: "Reads the wave in steps, from 256 down to 2. Turns any table into lo-fi, stepped tones." },
          { name: "FM ← other osc", text: "The other oscillator pushes this one's reading position: frequency modulation. Gives bells, electric pianos and metallic growls. Keep the other oscillator on; turn its Level down to hear only the effect. Its Pitch sets the character (whole octaves stay harmonic, other intervals turn clangy)." },
          { name: "Ring ← other osc", text: "Multiplies this oscillator by the other one: ring modulation, for hollow, bell and robot tones. As with FM, the other oscillator can be at Level 0 and still do its job." },
        ],
      },
    ],
    tips: [
      "Stack the two oscillators an octave or a fifth apart (Pitch +12 or +7) for a bigger sound.",
      "A unison stack of 5 to 8 voices with Detune around 20–30% is the classic wide lead and pad sound.",
      "Unison and polyphony multiply: 8 unison voices on a 6-note chord is 48 oscillators. Lower one or the other if the computer struggles.",
    ],
  },
  {
    id: "sub-noise",
    title: "Sub and Noise",
    nav: "Sub & Noise",
    lead: "Two simple sources beside the oscillators: weight underneath, and air on top.",
    groups: [
      {
        title: "Sub",
        lead: "A plain oscillator below the note, for low end you can rely on.",
        controls: [
          { name: "Power", text: "Turns the sub on or off." },
          { name: "Shape", range: "Sin · Tri · Saw · Sqr", text: "The sub's wave. Sine is the cleanest weight; triangle adds a little edge; saw and square are buzzier and come through on small speakers." },
          { name: "Octave", range: "0, −1 or −2 octaves · default −1", text: "How far below the note it plays." },
          { name: "Level", range: "0–100%", text: "How loud the sub is." },
          { name: "Pan", range: "Left to right", text: "Its place in the stereo field. Keep it centred for low end that holds up on any system." },
          { name: "To", range: "F1 · F2 · F1+2 · Out", text: "Where it goes. Out keeps the sub clean and steady while the filters move the rest of the sound." },
        ],
      },
      {
        title: "Noise",
        lead: "Noise adds breath, air and the scrape of an attack.",
        controls: [
          { name: "Power", text: "Turns the noise on or off." },
          { name: "Color", range: "White · Pink", text: "White noise is bright and hissy; pink noise is softer and fuller, closer to wind or breath." },
          { name: "Level", range: "0–100% · default 25%", text: "How loud the noise is. A few percent is often enough." },
          { name: "Pan", range: "Left to right", text: "Its place in the stereo field." },
          { name: "To", range: "F1 · F2 · F1+2 · Out", text: "Where it goes. Through a filter, the noise takes on the filter's tone." },
        ],
      },
    ],
    tips: ["For a short click at the start of every note, set Noise Level to 0 and modulate it with a fast envelope (Env 2 with a few milliseconds of decay)."],
  },
  {
    id: "filters",
    title: "Filters",
    lead: "Filter 1 and Filter 2 remove or boost parts of the sound. Sweeping a filter is the quickest way to make a sound move.",
    paragraphs: [
      "The picture on the left of each filter shows its response: which frequencies pass and which are cut. It moves as the cutoff is modulated. Filter 2's header also holds the routing switch: 1 → 2 sends Filter 1 into Filter 2; 1 | 2 runs them side by side, each with the sources sent to it.",
    ],
    groups: [
      {
        title: "The knobs",
        controls: [
          { name: "Power", text: "Turns the filter on or off. Sources sent to an off filter pass through it unchanged." },
          { name: "Type", text: "The kind of filter. The types are described below." },
          { name: "Cutoff", range: "20 Hz – 20 kHz", text: "Where the filter works. On a low-pass, lower values make the sound darker; on a high-pass, higher values make it thinner. On the comb filters it sets the pitch they ring at." },
          { name: "Reso", range: "0–100%", text: "Resonance: boosts the frequencies right at the cutoff. A little adds character; a lot makes the filter whistle and squelch." },
          { name: "Drive", range: "+0 to +24 dB", text: "Pushes the sound into the filter harder, for warm saturation and grit." },
          { name: "Morph / Damp / Vowel", range: "0–100%", text: "A knob whose job depends on the type: Morph on the Morph filter, Damp on the comb filters, Vowel on the vowel filter. Greyed out on the other types." },
          { name: "Key", range: "0–100%", text: "Key tracking: how far the cutoff follows the notes you play, measured from middle C. At 100% it moves an octave for every octave, so high notes stay as bright as low ones." },
          { name: "Mix", range: "0–100% · default 100%", text: "How much of the filtered sound you hear against the unfiltered one. Lower it to blend a filter's colour in gently." },
        ],
      },
      {
        title: "Filter types",
        controls: [
          { name: "Low 12", text: "Low-pass with a gentle slope: removes the highs softly. A good start for most sounds." },
          { name: "Low 24", text: "Low-pass with a steeper slope: darker and more obvious when it sweeps." },
          { name: "Ladder", text: "A classic four-stage ladder low-pass. Its resonance goes much further and squelches: the sound of acid basslines." },
          { name: "High 12 / High 24", text: "High-pass: removes the lows. Use it to keep pads and leads out of the bass's way." },
          { name: "Band", text: "Band-pass: keeps a band around the cutoff and removes both ends. Thin, telephone-like, focused." },
          { name: "Notch", text: "Removes a narrow band around the cutoff. Swept, it sounds like a phaser." },
          { name: "Morph", text: "Blends through low-pass, band-pass, high-pass and notch as the Morph knob turns, so one knob changes the filter's whole character." },
          { name: "Comb +", text: "A short, tuned delay fed back into itself. It rings at the cutoff's pitch: metallic, plucked and resonant tones. Reso sets how long it rings; Damp darkens the ringing. Set Key to 100% so it follows the notes." },
          { name: "Comb −", text: "The same with the feedback flipped: a hollower tone made of odd harmonics, which sounds an octave lower than Comb +." },
          { name: "Vowel", text: "Three resonant peaks that shape the sound like a voice. The Vowel knob moves through A, E, I, O and U; Cutoff shifts the voice higher or lower (1 kHz is natural); Reso makes the peaks sharper." },
        ],
      },
    ],
    tips: [
      "The classic move: Env 2 onto Filter 1 Cutoff, with a short decay and no sustain. Every note opens bright and closes down.",
      "Put Filter 2 on High 12 around 150–250 Hz on pads, so they leave room for the bass and the kick.",
    ],
  },
  {
    id: "voice",
    title: "Voice",
    lead: "How notes are played: chords or single notes, slides, pitch and touch.",
    groups: [
      {
        controls: [
          { name: "Poly · Mono · Legato", text: "Poly plays chords. Mono plays one note at a time; a new note takes over the last one. Legato is Mono, but overlapping notes don't restart the envelopes, so you can play smooth, connected lines." },
          { name: "Voices", range: "1–16 · default 8", text: "How many notes can sound at once in Poly mode. When you play more, the oldest note fades out quickly to make room." },
          { name: "Glide", range: "Off to 2 s", text: "Slides the pitch from one note to the next over this time. Most useful in Mono and Legato for basses and leads." },
          { name: "Pitch", range: "−48 to +48 semitones", text: "Transposes the whole synth." },
          { name: "Bend", range: "±0 to ±24 semitones · default ±2", text: "How far a full pitch-bend wheel moves the pitch." },
          { name: "Vel", range: "0–100% · default 60%", text: "How much velocity (how hard you play) sets the loudness. At 0% every note is equally loud, like an organ." },
        ],
      },
    ],
  },
  {
    id: "envelopes",
    title: "Envelopes",
    lead: "An envelope is a shape that plays out over each note: it rises when the note starts, holds while you hold the key, and falls when you let go.",
    paragraphs: [
      "There are three, on the tabs at the top of the panel. Env 1 (Amp) always shapes each note's volume. Env 2 and Env 3 do nothing until you connect them to a knob: drag the + handle beside their tab onto any knob that can be modulated.",
      "The graph is editable: drag the large points to change the times and levels, and drag the small points between them to bend each slope. Bending the attack outward makes it start fast and settle; bending it inward makes a slow swell.",
    ],
    groups: [
      {
        title: "The stages, in order",
        controls: [
          { name: "Delay", range: "0–4 s", text: "Waits this long after the note starts before the envelope begins." },
          { name: "Attack", range: "0–20 s · default 2 ms", text: "How long it takes to rise from nothing to the top. Short for plucks and basses, long for pads that swell in." },
          { name: "Hold", range: "0–4 s", text: "Stays at the top for this long before falling." },
          { name: "Decay", range: "1 ms – 30 s · default 0.6 s", text: "How long it takes to fall from the top to the sustain level." },
          { name: "Sustain", range: "0–100% · default 100%", text: "The level it stays at while you hold the note. At 0% the note dies away even if you keep holding it: a pluck." },
          { name: "Release", range: "1 ms – 30 s · default 0.15 s", text: "How long it takes to fall to nothing after you let go. Long releases let notes ring into each other." },
        ],
      },
    ],
    tips: [
      "A pluck: Attack 0, Decay 0.3–0.6 s, Sustain 0, Release about the same as Decay.",
      "A pad: Attack 0.5–2 s, Sustain high, Release 2–4 s.",
      "If notes click when they start or stop, raise Attack or Release by a few milliseconds.",
    ],
  },
  {
    id: "lfos",
    title: "LFOs",
    lead: "An LFO (low-frequency oscillator) is a wave too slow to hear. Connected to a knob, it moves that knob back and forth: vibrato, wobbles, tremolo and slow drift.",
    paragraphs: [
      "There are three, on the tabs at the top of the panel. Like Env 2 and Env 3, an LFO does nothing until you drag its + handle onto a knob. The picture shows its shape and where it is right now.",
    ],
    groups: [
      {
        controls: [
          { name: "Shape", range: "Sine, Triangle, Saw Down, Saw Up, Square, Random Steps, Random Smooth", text: "The wave the LFO follows. Sine and Triangle swing smoothly; the saws rise or fall then jump back; Square flips between two values; Random Steps jumps to a new random value each cycle; Random Smooth glides between them, for natural drift." },
          { name: "Retrigger · Free · One Shot", text: "Retrigger restarts the LFO with each note, so every note moves the same way. Free keeps it running, so notes catch it wherever it is. One Shot runs it once per note and stops: an extra envelope with any shape." },
          { name: "Sync / Hz", text: "Sync locks the rate to the project's tempo; Hz sets it freely in cycles per second." },
          { name: "Rate (Sync)", range: "8 bars to 1/32, with dotted (D) and triplet (T) lengths", text: "How long one cycle lasts, in bars and beats. 1/4 moves once per beat, 1/8 twice per beat." },
          { name: "Rate (Hz)", range: "0.01–40 Hz · default 2 Hz", text: "How many cycles per second. 5–6 Hz is a natural vibrato; below 0.5 Hz is slow drift." },
          { name: "Phase", range: "0–360°", text: "Where in its cycle the LFO starts when it restarts. Set 270° on a sine to start from its lowest point." },
          { name: "Fade In", range: "Off to 10 s", text: "Brings the LFO in gradually after each note starts. The classic use is delayed vibrato: the note starts straight, then begins to waver." },
        ],
      },
    ],
    tips: ["Vibrato: a sine LFO at about 5 Hz on both oscillators' Pitch, with a small amount and some Fade In.", "Wobble bass: a synced sine LFO at 1/8 or 1/4 on Filter 1 Cutoff, set to Retrigger so each note starts the wobble the same way."],
  },
  {
    id: "sources-macros",
    title: "Sources and macros",
    nav: "Sources & macros",
    lead: "The panel at the bottom right holds the other modulation sources and the four macros.",
    groups: [
      {
        title: "Sources",
        lead: "Drag a source's + handle onto a knob to use it.",
        controls: [
          { name: "Velocity", text: "How hard each note is played. Use it to make harder notes brighter (onto Filter Cutoff) or more distorted (onto Drive or Warp)." },
          { name: "Note", text: "Which note is played, from low to high. Use it to make higher notes brighter, or to pan notes across the keyboard." },
          { name: "Mod Wheel", text: "Your controller's mod wheel. A good home for vibrato depth, brightness or warp, so you can play it live." },
          { name: "Pitch Bend", text: "The pitch-bend wheel. It already bends the pitch by the Bend range; connect it elsewhere for extra moves." },
          { name: "Random", text: "A new random value for every note. A little on Pitch, Pan or Cutoff makes repeated notes sound less mechanical." },
        ],
      },
      {
        title: "Macros",
        lead: "A macro is a knob that turns other knobs.",
        controls: [
          {
            name: "M1 – M4",
            range: "0–100%",
            text: "Drag a macro's + handle onto several knobs, set each amount, then turn the macro to move them all at once. Many presets put their main move on M1, like brightness or distortion.",
          },
        ],
      },
    ],
  },
  {
    id: "modulation",
    title: "Modulation, step by step",
    nav: "Modulation",
    lead: "Modulation is what makes a sound move. In Daybreak, any source can move almost any knob, and one source can move many.",
    steps: [
      { title: "Drag a source onto a knob", text: "Find the source's + handle: on the envelope and LFO tabs, beside each source in the Sources panel, and under each macro. Drag it onto a knob. The knob lights up when it can take it, and a coloured ring appears around it." },
      { title: "Set the amount", text: "Right-click the knob to see its modulations and drag an amount. The amount is a share of the knob's full travel, from −100% to +100%; negative amounts push the knob the other way." },
      { title: "Choose one way or both ways", text: "The ± button switches a route between unipolar (it only pushes one way from where the knob sits) and bipolar (it swings both ways around it). LFOs, Pitch Bend and Random start bipolar; envelopes, velocity and macros start unipolar." },
      { title: "See what a source does", text: "Click a source's handle to highlight every knob it moves. Click it again, or anywhere in the window, to clear the highlight." },
      { title: "Use the Matrix page for the whole picture", text: "The Matrix tab lists every route, up to 32: its source, destination, amount and ±. Change any of them there, remove one with ×, or click Add modulation to add one without dragging." },
    ],
    paragraphs: [
      "Modulation moves a knob from where you set it. If Filter 1 Cutoff sits at 800 Hz and Env 2 pushes it +40%, the cutoff starts near the top of its travel and falls back to 800 Hz as the envelope decays. On frequency and time knobs, the travel is spaced like the knob itself, so equal amounts sound like equal moves.",
      "Knobs that can be modulated: oscillator Level, Pan, Position, Warp, Pitch, Fine, Detune, Blend and Width; sub and noise Level and Pan; every filter knob except Key; each LFO's rate; and the synth's Pitch and Volume. Settings that pick a count or a mode, like Unison, Voices or envelope times, are set by hand.",
    ],
  },
  {
    id: "recipes",
    title: "Recipes",
    lead: "Sounds to build from Init, to learn how the parts work together.",
    recipes: [
      {
        title: "Warm pad",
        sound: "A wide, slow chord pad.",
        steps: [
          "Load Init. On Osc 1 choose the Daybreak table, set Position to 30%, Unison to 7, Detune to 25% and Width to 100%.",
          "Turn on Osc 2, set its Pitch to +12 and its Level to about 30%.",
          "Set Filter 1 to Low 24 with Cutoff around 2 kHz.",
          "On Env 1 set Attack to 1 s, Sustain to 90% and Release to 2.5 s.",
          "Drag LFO 3's handle onto Osc 1 Position, set the LFO to Random Smooth at 0.2 Hz, and keep the amount small (10–20%).",
        ],
      },
      {
        title: "Punchy bass",
        sound: "A short, solid bass that cuts through.",
        steps: [
          "Load Init. Set Voice to Legato with a little Glide (30–50 ms).",
          "On Osc 1 keep Basic Shapes around 50% (a saw) and set Rand to 0% so every note hits the same.",
          "Turn on the Sub: Sine, −1 octave, To set to Out.",
          "Set Filter 1 to Ladder with Cutoff around 400 Hz and Reso around 30%.",
          "Drag Env 2's handle onto Filter 1 Cutoff with about +35%. Set Env 2's Decay to 0.2 s and Sustain to 0.",
        ],
      },
      {
        title: "Pluck",
        sound: "A bright note that blooms and dies away.",
        steps: [
          "Load Init. On Osc 1 choose Bells or Daybreak, with Unison 3 and Detune 10–20%.",
          "On Env 1 set Decay to 0.5 s, Sustain to 0 and Release to 0.4 s.",
          "Set Filter 1 to Low 24 around 900 Hz, and drag Env 2 onto its Cutoff with about +40%. Set Env 2's Decay to 0.3 s and Sustain to 0.",
          "Drag Velocity onto Filter 1 Cutoff with a small amount, so harder notes are brighter.",
        ],
      },
      {
        title: "Wobble bass",
        sound: "A bass that moves in time with the song.",
        steps: [
          "Start from the Punchy bass above, with Filter 1 on Low 24 and Cutoff low (around 300 Hz).",
          "Set LFO 1 to Sine, Sync on, Rate 1/8, mode Retrigger.",
          "Drag LFO 1 onto Filter 1 Cutoff with about +50%, and switch the route to unipolar.",
          "On the Matrix page, add a route from Macro 1 to LFO 1 Rate, so one knob speeds the wobble up for the drop. (A synced Rate knob takes modulation from the Matrix page only.)",
        ],
      },
      {
        title: "Pumping pad",
        sound: "A pad that ducks on every beat, as if the kick pushed it down.",
        steps: [
          "Make any pad, or load one.",
          "Set LFO 1 to Saw Up, Sync on, Rate 1/4, mode Retrigger.",
          "Drag LFO 1 onto the header's Volume knob with about +20%, unipolar, and lower the Volume knob by about as many dB as the swing adds.",
          "Play chords on the beat: each one dips and swells back in time.",
        ],
      },
    ],
  },
  {
    id: "presets",
    title: "The presets",
    lead: "Every sound that comes with Daybreak. Load one, then open its Matrix page to see how it moves.",
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    lead: "When something doesn't sound right.",
    groups: [
      {
        controls: [
          { name: "No sound", text: "Check that an oscillator is on with its Level up, that its To switch goes to a filter that is open (Cutoff not at the bottom), and that the Volume knob isn't at −48 dB. The track needs Synth chosen in its Instrument card, and the voices counter shows whether notes arrive at all." },
          { name: "Clicks at the start or end of notes", text: "Give Env 1 a few milliseconds of Attack and Release." },
          { name: "Too loud or distorting", text: "Big unison stacks, chords and Drive add up. Lower the Volume knob, the oscillator Levels or the Drive, and watch the track's meter." },
          { name: "Muddy low end", text: "Put Filter 2 on High 12 for pads and leads, keep the Sub centred, and avoid wide unison on low notes." },
          { name: "Crackles or dropouts", text: "Daybreak works hardest with many unison voices on many notes. Lower Unison or the Voices count, or close other heavy tabs and apps." },
          { name: "A modulation does nothing", text: "Check its amount on the Matrix page, and whether the knob is already at the end of its travel in that direction. Env 2, Env 3 and the LFOs only work once connected." },
        ],
      },
    ],
  },
];

/** One line on each factory preset, for the guide's preset list. */
export const DAYBREAK_PRESET_NOTES: Record<string, string> = {
  Init: "One saw into an open filter. The blank page to build from.",
  "Dawn Sub": "A round sub bass with a soft filter bite at the start of each note.",
  Reese: "A detuned, slowly moving bass for drum & bass and dark pop.",
  "Acid Line": "A squelchy ladder-filter bass. Play it legato for slides.",
  Growler: "A talking, growling bass moving in eighth notes.",
  Wobble: "A tempo-synced wobble bass. Macro 1 speeds the wobble up.",
  "FM Pluck Bass": "A short, punchy FM bass with a soft sub.",
  "Daybreak Lead": "A wide lead with delayed vibrato. The mod wheel opens the filter.",
  "Sync Scream": "A hard-sync lead that tears open. The mod wheel adds more.",
  "Pulse Lead": "Two moving pulse waves: a bright, retro lead.",
  "Vowel Lead": "A lead that sings through the vowels.",
  "Chip Arp": "A crunchy, stepped lead for arpeggios.",
  "Sunrise Pad": "A warm pad that slowly opens up, the sound of the synth's name.",
  "Glass Pad": "A clear, shimmering bell pad.",
  "Choir Air": "A breathy choir with moving vowels.",
  "Analog Strings": "A big detuned string ensemble.",
  "Evolving Wash": "A slow, drifting texture for ambient beds.",
  "Prism Bloom": "A wide supersaw pad that blooms open. Macro 1 brightens it.",
  "Pump Glow": "A chord pad that pumps on every beat, like a sidechained pad.",
  "Ember Low": "A dark, heavy pad with a sub underneath. Macro 1 opens it up.",
  "Halo Voices": "Airy vocal layers with a slowly moving vowel.",
  "Neon Fifths": "A bright, lead-like pad with a fifth on top. The mod wheel adds bite.",
  "Blaze Wall": "A driven, folded wall of sound pulsing in eighths. Macro 1 adds heat.",
  "Crystal Pluck": "A bright bell pluck that follows how hard you play.",
  "Dawn Pluck": "A wide pluck whose wave blooms and closes.",
  "Plucked String": "A noise burst ringing a tuned comb filter: a plucked string.",
  Kalimba: "A soft FM thumb piano.",
  "Drawbar Organ": "An organ with a rotating shimmer. Macro 1 pulls out more drawbars.",
  "Electric Keys": "An FM electric piano with gentle auto-pan.",
  "Bell Keys": "Clear bell keys that ring out.",
  Riser: "A rising build-up of noise and sync over several seconds.",
  "Glitch Stab": "A stepped, glitchy stab for fills.",
  "Metal Hit": "A clanging ring-modulated hit.",
  "Laser Zap": "A falling FM zap.",
};

export const PRESET_CATEGORY_NOTES: Record<PresetCategory, string> = {
  Bass: "Low end, from clean subs to growls.",
  Lead: "Single lines that cut through.",
  Pad: "Long, wide chords and textures.",
  Pluck: "Short notes that ring and die away.",
  Keys: "Organs, electric pianos and bells.",
  FX: "Risers, hits and zaps.",
};
