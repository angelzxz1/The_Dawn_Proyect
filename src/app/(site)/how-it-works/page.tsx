import type { Metadata } from "next";
import type { ReactNode } from "react";
import { InputLevel, LatencyBar, RecordedClip, StatusChips, Well } from "@/components/site/illustrations";
import { SetupGuides, Walkthrough, type WalkStep } from "@/components/site/interactive";
import { CheckIcon, Container, CtaBand, Eyebrow, JumpLinks, PageIntro, SectionHead, h2Class, leadClass } from "@/components/site/ui";
import { PROJECT_TEMPLATES } from "@/lib/templates";

export const metadata: Metadata = {
  title: "How it works",
  description: "From an empty tab to an MP3 you can send in five steps, plus setup guides for guitarists and producers, latency explained, and fixes for common problems.",
};

function Tips({ tips }: { tips: string[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {tips.map((t) => (
        <li key={t} className="flex items-start gap-2.5 text-[15px] text-soft">
          <CheckIcon size={16} />
          {t}
        </li>
      ))}
    </ul>
  );
}

function StepBody({ text, visual, tips }: { text: string; visual: ReactNode; tips: string[] }) {
  return (
    <>
      <p className="text-[17px] leading-[1.6] text-soft">{text}</p>
      {visual}
      <Tips tips={tips} />
    </>
  );
}

const GROOVES: [string, string][] = [
  ["Rock", "Intro · Verse · Chorus · Fill · Ending"],
  ["Funk", "Verse · Chorus · Fill"],
  ["6/8 Ballad", "Verse · Chorus · Ending"],
  ["Hip-Hop", "Verse · Chorus · Fill"],
];

const STEPS: WalkStep[] = [
  {
    title: "Pick a template",
    time: "~1 min",
    body: (
      <StepBody
        text="Open Dawn and choose a starting point. Every template is a real project with tracks, instruments and effects already set up, so it makes sound within three clicks."
        visual={
          <Well className="flex flex-col gap-3">
            <div className="text-[11px] font-semibold tracking-[1.6px] text-muted">START A NEW PROJECT</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5">
              {PROJECT_TEMPLATES.map((t, i) => (
                <div key={t.id} className={`flex flex-col gap-1 rounded-[10px] border p-3.5 ${i === 0 ? "border-accent bg-glow" : "border-border bg-surface"}`}>
                  <span className="font-display text-[16px] font-semibold text-foreground">{t.name}</span>
                  <span className="text-[13px] leading-snug text-muted">{t.description}</span>
                </div>
              ))}
            </div>
          </Well>
        }
        tips={["Guitar Demo is the fastest way to record a riff.", "Your recent projects are listed there too, one click away."]}
      />
    ),
  },
  {
    title: "Set up your input",
    time: "~2 min",
    body: (
      <StepBody
        text="Choose your interface input on the guitar track and play. Aim for peaks around −12 dBFS and never let the clip light turn on."
        visual={
          <Well className="flex flex-col gap-3.5">
            <StatusChips chips={[{ text: "Input: Interface · In 1" }, { text: "Monitoring: on", tone: "accent" }, { text: "Echo cancel / noise / AGC: off", tone: "dim" }]} />
            <InputLevel />
          </Well>
        }
        tips={["Use wired headphones; Bluetooth adds delay.", "Turn monitoring on to hear yourself through the amp."]}
      />
    ),
  },
  {
    title: "Record",
    time: "~3 min",
    body: (
      <StepBody
        text="Press R. Dawn counts you in, plays the metronome and the drums, and lines your take up with the grid when you stop."
        visual={
          <Well className="flex flex-col gap-3.5">
            <StatusChips chips={[{ text: "● REC", tone: "rec" }, { text: "Count-in: 1 bar" }, { text: "Metronome on" }, { text: "Loop 1.1.1 → 5.1.1", tone: "accent" }]} />
            <RecordedClip />
          </Well>
        }
        tips={["Loop a section to try several takes.", "If takes land early or late, set the recording offset once."]}
      />
    ),
  },
  {
    title: "Build the song",
    time: "~2 min",
    body: (
      <StepBody
        text="Drag grooves onto the drum track for each section, then copy your riff into the chorus. Add bass with the synth or the piano roll."
        visual={
          <Well className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
            <div className="flex flex-col gap-2">
              <div className="text-[11px] font-semibold tracking-[1.6px] text-muted">GROOVES</div>
              {GROOVES.map(([name, sections]) => (
                <div key={name} className="rounded-lg border border-border bg-surface px-3 py-2">
                  <div className="text-[14px] font-semibold text-foreground">{name}</div>
                  <div className="text-[12px] text-muted">{sections}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              {[
                ["Drums", ["Verse", "Chorus", "Fill"]],
                ["Guitar", ["Riff", "Riff (copy)", ""]],
                ["Bass", ["", "Bass line", ""]],
              ].map(([track, clips]) => (
                <div key={track as string} className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-[12px] font-semibold text-soft">{track}</span>
                  <div className="grid flex-1 grid-cols-3 gap-1">
                    {(clips as string[]).map((c, i) => (
                      <span key={i} className={`h-8 truncate rounded-md px-1.5 py-1 text-[11px] font-semibold ${c ? "bg-accent/80 text-background" : "bg-surface-raised"}`}>
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              <p className="pt-1 font-code text-[10.5px] text-muted">Drag a groove onto the drum track · Ctrl/Cmd+C, V to copy a clip</p>
            </div>
          </Well>
        }
        tips={["Grooves follow the project tempo automatically.", "Ctrl/Cmd+C and V copy a clip to the playhead."]}
      />
    ),
  },
  {
    title: "Mix and export",
    time: "~2 min",
    body: (
      <StepBody
        text="Balance the levels, add an EQ or a reverb send, then export. MP3 for your band chat, WAV for quality, stems and MIDI for another DAW."
        visual={
          <Well className="flex max-w-[420px] flex-col gap-2.5">
            <div className="font-display text-[17px] font-semibold text-foreground">Export</div>
            <div className="flex gap-1.5">
              {["MP3", "WAV", "Stems"].map((f) => (
                <span key={f} className={`rounded-md border px-2.5 py-1 text-[12px] font-semibold ${f === "MP3" ? "border-accent bg-accent text-background" : "border-border text-soft"}`}>
                  {f}
                </span>
              ))}
            </div>
            {[
              ["Quality", "320 kbps"],
              ["Range", "Whole song"],
              ["Normalize peaks", "On"],
              ["Reverb tail", "2 s"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-[13px]">
                <span className="text-muted">{k}</span>
                <span className="font-code text-foreground">{v}</span>
              </div>
            ))}
            <span className="mt-1 rounded-lg bg-accent px-3 py-2 text-center text-[13px] font-semibold text-background">Export late-night-riff.mp3</span>
          </Well>
        }
        tips={["Exports render exactly what you hear.", "MIDI exports from a track or clip's menu, as a .mid file."]}
      />
    ),
  },
];

const GUIDES = [
  {
    id: "guitar",
    label: "Guitarist",
    steps: [
      { title: "What you need", text: "A guitar, an audio interface or USB guitar cable, wired headphones, and Chrome or Edge on a desktop computer." },
      { title: "Connect and choose the input", text: "Plug in, then pick your interface input on the guitar track." },
      { title: "Set your level", text: "Aim for peaks around −12 dBFS. If the clip light turns on, turn the gain down on your interface." },
      { title: 'Turn off system "enhancements"', text: "Disable any noise reduction or audio effects on the input device in your operating system settings." },
      { title: "Monitor through the amp", text: "Turn on monitoring with the headphones button to hear your guitar through the NAM Amp." },
      { title: "Keep latency low", text: "Use wired headphones, close heavy tabs, plug the laptop in, and choose lighter amp captures on older machines." },
      { title: "Set the recording offset", text: "If takes land early or late, record a few notes against the metronome and adjust the offset once." },
    ],
  },
  {
    id: "producer",
    label: "Producer",
    steps: [
      { title: "Plug in a MIDI controller", text: "Dawn picks it up automatically. No controller? Play with your computer keyboard." },
      { title: "Sketch with grooves and the synth", text: "Drag a groove onto the drum track, pick a synth preset and draw notes in the piano roll." },
      { title: "Sidechain the bass to the kick", text: "Add a compressor to the bass, choose the kick as its sidechain source, and set the amount." },
      { title: "Take it to your main DAW", text: "Export stems and MIDI. Everything lines up from the first bar." },
    ],
  },
];

const LATENCY_TIPS: [string, string][] = [
  ["Wired headphones", "Bluetooth alone can add more delay than everything else combined."],
  ["Fewer tabs", "Close heavy tabs and apps while you record."],
  ["Plugged in", "Laptops on battery often slow the audio down."],
  ["Lighter captures", "Pick the light version of a tone on older machines."],
];

const FIXES: [string, string][] = [
  ["No input", "Check the input chosen on the track, allow microphone access in the browser, and make sure the interface is connected before opening Dawn."],
  ["Crackles or dropouts", "Close other tabs, plug the laptop in, and switch to a lighter amp capture. Watch the CPU meter in the header."],
  ["Feedback or howling", "Use headphones instead of speakers while monitoring, and turn the monitoring level down."],
  ["Recordings out of time", "Set the recording offset once. Record a few notes on the beat, then nudge the offset until they line up."],
];

export default function HowItWorksPage() {
  return (
    <>
      <PageIntro eyebrow="How it works" title="Idea to demo before the idea fades." lead="Five steps from an empty tab to an MP3 you can send. Most people get there in about ten minutes.">
        <JumpLinks
          label="On this page"
          links={[
            ["#walkthrough", "Walkthrough"],
            ["#setup", "Setup guides"],
            ["#latency", "Latency"],
            ["#troubleshooting", "Troubleshooting"],
          ]}
        />
      </PageIntro>

      <section id="walkthrough" aria-labelledby="walk-h" className="scroll-mt-6 pt-[88px]">
        <Container className="flex flex-col gap-7">
          <h2 id="walk-h" className={`${h2Class} text-[clamp(28px,3vw,36px)]`}>
            The walkthrough
          </h2>
          <Walkthrough steps={STEPS} />
        </Container>
      </section>

      <section id="setup" aria-labelledby="setup-h" className="scroll-mt-6 pt-[104px]">
        <Container className="flex flex-col gap-6">
          <SectionHead id="setup-h" eyebrow="Setup guides" title="Get set up once, then just play." />
          <SetupGuides guides={GUIDES} />
        </Container>
      </section>

      <section id="latency" aria-labelledby="lat-h" className="scroll-mt-6 pt-[104px]">
        <Container>
          <div className="flex flex-col gap-7 rounded-[18px] border border-border bg-surface p-[clamp(24px,4vw,44px)]">
            <div className="flex max-w-[720px] flex-col gap-3.5">
              <Eyebrow>Latency, simply</Eyebrow>
              <h2 id="lat-h" className={`${h2Class} text-[clamp(28px,3vw,38px)]`}>
                Why there&rsquo;s a small delay, and how to shrink it.
              </h2>
              <p className={leadClass}>
                Your guitar&rsquo;s sound passes through your interface, the browser and the amp before it reaches your ears. Each step adds a few milliseconds.
                The total depends on your hardware, and Dawn shows it in the audio panel in its header.
              </p>
            </div>
            <LatencyBar />
            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
              {LATENCY_TIPS.map(([title, text]) => (
                <div key={title} className="flex flex-col gap-1.5 rounded-xl border border-border bg-background p-4">
                  <strong className="text-[15px] font-semibold text-foreground">{title}</strong>
                  <span className="text-[14.5px] leading-normal text-soft">{text}</span>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </section>

      <section id="troubleshooting" aria-labelledby="tr-h" className="scroll-mt-6 pt-[104px]">
        <Container className="flex flex-col gap-7">
          <SectionHead id="tr-h" eyebrow="Troubleshooting" title="Something not right?" lead="Still stuck? Ask in #help on the Discord and include your browser and audio interface." />
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-4 py-3 text-[11px] font-semibold tracking-[1.6px] text-muted">
                    PROBLEM
                  </th>
                  <th scope="col" className="px-4 py-3 text-[11px] font-semibold tracking-[1.6px] text-muted">
                    TRY THIS
                  </th>
                </tr>
              </thead>
              <tbody>
                {FIXES.map(([problem, fix]) => (
                  <tr key={problem} className="border-b border-border last:border-b-0">
                    <th scope="row" className="w-[28%] px-4 py-4 align-top text-[16px] font-semibold text-foreground">
                      {problem}
                    </th>
                    <td className="px-4 py-4 text-[15px] leading-normal text-soft">{fix}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </section>

      <CtaBand />
    </>
  );
}
