import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AlignedTake, ChainChips, DeviceCard, ExportList, FileTree, PianoRoll, Routing, StatusChips, Well } from "@/site/illustrations";
import { EffectsGrid, type EffectInfo } from "@/site/interactive";
import { CheckList, Container, CtaBand, JumpLinks, PageIntro, SectionHead, secondaryButton } from "@/site/ui";
import { EFFECT_GROUPS, EFFECT_LABELS, type EffectType } from "@/effects/registry";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Features",
  description: "Recording, NAM amp models and cabinet IRs, 18 effects, sidechain, buses, automation, three instruments and honest exports, all in a browser tab.",
};

/** One line on each effect; the list itself comes from the studio. */
const EFFECT_NOTES: Record<EffectType, string> = {
  compressor: "Threshold, ratio, knee and makeup, with a live transfer curve.",
  glue: "Gentle bus compression that holds a mix together.",
  multiband: "Compress lows, mids and highs separately.",
  mbDynamics: "Shape the dynamics of each band on its own.",
  limiter: "Set a ceiling and keep peaks under it.",
  gate: "Silence hum and noise between notes.",
  paramEq: "24 bands, mid/side and a live analyzer.",
  eq3: "Fast low, mid and high tone shaping.",
  filter: "Low-pass, high-pass, band-pass and more, with resonance.",
  chorus: "Thicken and widen with modulated delay.",
  pitchShift: "Move a sound up or down by semitones.",
  distortion: "From warmth to grit, with oversampling.",
  reverb: "Rooms, halls and plates, from short to huge.",
  delay: "Tempo-synced repeats with feedback.",
  tubeAmp: "A modeled high-gain tube amp, tuned against a real head.",
  namAmp: "Real amp captures via Neural Amp Modeler.",
  irLoader: "Cabinet impulse responses for any amp.",
  utility: "Gain, pan and other everyday fixes.",
  tuner: "Tune up before you record.",
};

const EFFECTS: EffectInfo[] = EFFECT_GROUPS.flatMap((g) => g.types.map((t) => ({ category: g.name, name: EFFECT_LABELS[t], description: EFFECT_NOTES[t] })));

const HOOD: [string, string][] = [
  ["AudioWorklets", "Custom DSP runs on the browser's real-time audio thread, not the main page."],
  ["One DSP source", "The same code runs in the audio worklet, the plugin windows and the unit tests."],
  ["NAM in WebAssembly", "The Neural Amp Modeler core is compiled to WebAssembly to run amp captures in real time."],
  ["Delay compensation", "Tracks with heavier effects are delayed to match, so everything stays in time."],
  ["Faithful bounce", "Export rebuilds the same audio graph offline, so what you hear is what you get."],
  ["Local first", "Projects live in folders on your computer through the File System Access API."],
];

const NEXT: [string, string][] = [
  ["Loop recording with take comping", "Record several takes and keep the best parts."],
  ["Bass instrument", "A sampled bass, plus bass amp captures."],
  ["Sampler", "Load a sample, play it chromatically or slice loops."],
  ["Mixer view", "Channel strips side by side."],
  ["Spanish interface", "Dawn en español."],
  ["Loudness meter", "LUFS and reference-track A/B."],
];

/** A feature section: the words on one side, a drawing on the other. */
function Feature({
  id,
  eyebrow,
  title,
  lead,
  items,
  visual,
  flip,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead: string;
  items: { strong?: string; text: ReactNode }[];
  visual: ReactNode;
  flip?: boolean;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-6 pt-[104px]">
      <Container className={`flex flex-wrap items-center gap-[clamp(32px,5vw,64px)] ${flip ? "flex-wrap-reverse" : ""}`}>
        <div className={`flex min-w-0 flex-[1_1_420px] flex-col gap-6 ${flip ? "order-2" : ""}`}>
          <SectionHead id={`${id}-h`} eyebrow={eyebrow} title={title} lead={lead} />
          <CheckList items={items} />
        </div>
        <div className={`min-w-0 flex-[1_1_420px] ${flip ? "order-1" : ""}`}>{visual}</div>
      </Container>
    </section>
  );
}

export default function FeaturesPage() {
  return (
    <>
      <PageIntro
        eyebrow="Features"
        title="A real studio, in the tab you already have open."
        lead="Recording, guitar amps, 18 effects, sidechain, buses, automation, three instruments and honest exports. Here is everything Dawn does today."
      >
        <JumpLinks
          label="On this page"
          links={[
            ["#recording", "Recording"],
            ["#tones", "Guitar tones"],
            ["#effects", "Effects"],
            ["#mixing", "Mixing"],
            ["#instruments", "Instruments & MIDI"],
            ["#projects", "Projects & export"],
            ["#hood", "Under the hood"],
          ]}
        />
      </PageIntro>

      <Feature
        id="recording"
        eyebrow="Recording"
        title="Takes that land on the beat."
        lead="Plug in, arm a track and press R. Dawn measures your latency and lines every take up with the grid."
        items={[
          { strong: "Count-in, loop and metronome", text: "so you can focus on playing." },
          { strong: "Latency alignment", text: "with a manual offset for your exact setup." },
          { strong: "Multi-channel MIDI recording", text: "with each track armed on its own." },
          { strong: "Clean input", text: "with the browser's voice-call processing turned off." },
        ]}
        visual={
          <Well className="flex flex-col gap-3.5">
            <StatusChips
              chips={[{ text: "● REC", tone: "rec" }, { text: "Count-in 1 bar" }, { text: "Metronome on" }, { text: "Latency 11 ms", tone: "dim" }, { text: "Offset −3 ms", tone: "accent" }]}
            />
            <AlignedTake />
          </Well>
        }
      />

      <Feature
        id="tones"
        flip
        eyebrow="Guitar tones"
        title="Your amp, in a browser tab."
        lead="Neural Amp Modeler captures and cabinet impulse responses run in real time, so you can play through a real amp sound with nothing installed."
        items={[
          { strong: "NAM Amp", text: "loads any .nam capture." },
          { strong: "IR Loader", text: "loads any cabinet impulse response." },
          { strong: "Ready-made chains", text: "from gate to amp, cabinet, EQ and reverb." },
          { strong: "Light captures", text: "for older laptops." },
        ]}
        visual={
          <Well className="flex flex-col gap-4">
            <ChainChips items={["Input", "Noise Gate", "NAM Amp", "IR Loader", "Parametric EQ", "Reverb send"]} hot={["NAM Amp", "IR Loader"]} />
            <div className="flex flex-wrap gap-3">
              <DeviceCard name="NAM Amp" tag="crunch.nam" knobs={[["INPUT", 0.45], ["TONE", 0.6], ["OUTPUT", 0.5]]} />
              <DeviceCard name="IR Loader" tag="2x12-closed.wav" knobs={[["LOW CUT", 0.2], ["HIGH CUT", 0.7], ["MIX", 1]]} />
            </div>
            <p className="font-code text-[11px] text-muted">Drop any .nam capture or cabinet .wav onto the device to load it.</p>
          </Well>
        }
      />

      <section id="effects" aria-labelledby="effects-h" className="scroll-mt-6 pt-[104px]">
        <Container className="flex flex-col gap-8">
          <SectionHead
            id="effects-h"
            eyebrow="Effects"
            title="18 studio effects. No plugins to buy."
            lead="Every effect runs inside the browser's audio engine, works on any track or bus, and every knob can be automated."
            className="max-w-[720px]"
          />
          <EffectsGrid categories={EFFECT_GROUPS.map((g) => g.name)} effects={EFFECTS} />
        </Container>
      </section>

      <Feature
        id="mixing"
        flip
        eyebrow="Mixing"
        title="Real mixing workflows, not a toy."
        lead="Route, duck and automate like you would in any studio, and trust that everything stays in time."
        items={[
          { strong: "Sidechain", text: "on five dynamics effects. Duck the bass under the kick in two clicks." },
          { strong: "Send/return buses", text: "for shared reverbs and delays." },
          { strong: "Master bus", text: "with its own limiter and effects." },
          { strong: "Automation", text: "of any knob on any device." },
          { strong: "Delay compensation", text: "keeps tracks with heavy effects in time." },
        ]}
        visual={
          <Well>
            <Routing />
          </Well>
        }
      />

      <Feature
        id="instruments"
        eyebrow="Instruments & MIDI"
        title="Sketch ideas with keys, pads or a controller."
        lead="Play with a MIDI controller, the mouse or your computer keyboard, then shape the notes in the piano roll."
        items={[
          { strong: "Three instruments:", text: "a sampled grand piano, a drum kit and a wavetable synth." },
          { strong: "Piano roll", text: "with scale highlighting." },
          { strong: "Grooves", text: "to drag onto a drum track." },
          { strong: "MIDI in and out", text: "with .mid import and export." },
        ]}
        visual={
          <Well className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {["Grand piano", "Drum kit", "Wavetable synth"].map((name) => (
                <span
                  key={name}
                  className={`rounded-lg border px-3 py-1.5 text-[13px] font-semibold ${name === "Wavetable synth" ? "border-accent bg-accent text-background" : "border-border-strong bg-surface text-foreground"}`}
                >
                  {name}
                </span>
              ))}
              <span className="ml-auto font-code text-[11px] text-muted">Scale: E minor</span>
            </div>
            <PianoRoll />
          </Well>
        }
      />

      <Feature
        id="projects"
        flip
        eyebrow="Projects & export"
        title="Your files, on your computer."
        lead="No account and no cloud. Projects are folders you can back up, move and open again, with your undo history inside."
        items={[
          { strong: "Autosave", text: "in the browser between saves." },
          { strong: "Undo history", text: "saved with the project." },
          { strong: "Export", text: "to MP3, WAV, stems and MIDI." },
          { strong: "Stems that line up", text: "so you can finish in any other DAW." },
        ]}
        visual={
          <Well className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-6">
            <FileTree
              lines={[
                { text: "▾ Late Night Riff/", depth: 0 },
                { text: "project.json", depth: 1 },
                { text: "history.json", depth: 1 },
                { text: "▾ audio/", depth: 1 },
                { text: "guitar-take-3.wav", depth: 2 },
                { text: "vocals-take-1.wav", depth: 2 },
                { text: "late-night-riff.mp3", depth: 0, hot: true },
              ]}
            />
            <ExportList />
          </Well>
        }
      />

      <section id="hood" aria-labelledby="hood-h" className="scroll-mt-6 pt-[104px]">
        <Container className="flex flex-col gap-8">
          <SectionHead id="hood-h" eyebrow="Under the hood" title="Built like a real audio engine." lead="For the curious: what makes Dawn sound right and stay in time in a browser tab." />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-px overflow-hidden rounded-2xl border border-border bg-border">
            {HOOD.map(([title, text], i) => (
              <div key={title} className="flex flex-col gap-2 bg-background p-6">
                <span className="font-code text-[12px] text-accent">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="font-display text-[20px] font-semibold text-foreground">{title}</h3>
                <p className="text-[15px] leading-normal text-soft">{text}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section id="next" aria-labelledby="next-h" className="pt-[104px]">
        <Container className="flex flex-col gap-8">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <SectionHead id="next-h" eyebrow="What's next" title="A new headline feature every month." lead="Supporters vote on what gets built next. These are on the list." />
            <Link href="/support" className={secondaryButton}>
              Vote as a supporter
            </Link>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
            {NEXT.map(([title, text]) => (
              <li key={title} className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface px-[18px] py-4">
                <span className="font-code text-[10px] tracking-[1px] text-accent">PLANNED</span>
                <span className="text-[16px] font-semibold text-foreground">{title}</span>
                <span className="text-[14.5px] text-soft">{text}</span>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <CtaBand />
    </>
  );
}
