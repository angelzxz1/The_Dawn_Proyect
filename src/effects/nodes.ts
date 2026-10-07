// The factory for every effect type's audio node, and how each parameter is
// applied. Shared by the live engine and the export, so both build
// identical chains.

import * as Tone from "tone";
import { type EffectType, defaultParams } from "./registry";
import { CompressorChain } from "./compressor/compressor";
import { GlueChain } from "./glue/glue";
import { MbDynamicsChain } from "./multiband-dynamics/mbDynamics";
import { LookaheadLimiter } from "./limiter/lookaheadLimiter";
import { PitchShifter } from "./pitch-shift/pitchShifter";
import { NamAmpChain } from "./nam-amp/namAmp";
import { AmpSimChain } from "./furnace/ampSim";
import { NoiseGate } from "./gate/noiseGate";
import { ParamEqChain } from "./parametric-eq/paramEq";
import { MultibandChain } from "./multiband/multiband";
import { UtilityChain } from "./utility/utility";
import { TunerChain } from "./tuner/tuner";
import { SaturatorChain } from "./saturator/saturator";
import { DelayChain } from "./delay/delayChain";
import { ReverbChain } from "./reverb/reverbChain";
import { FilterChain } from "./filter/filterChain";
import { legacyFilterTypeToMode } from "./filter/filterModel";
import { ChorusChain } from "./chorus/chorusChain";
import { IrLoaderChain } from "./ir-loader/irLoaderChain";

export { DelayChain, ReverbChain, FilterChain, ChorusChain, IrLoaderChain };

export function createEffectNode(type: EffectType, savedParams: Record<string, number>): Tone.ToneAudioNode {
  // Params saved before an effect gained new controls lack those keys (the
  // live engine fills them via addEffect's defaults, but the WAV export
  // builds straight from saved params) - fill them in so nothing gets NaN.
  const params = { ...defaultParams(type), ...savedParams };
  switch (type) {
    case "eq3":
      return new Tone.EQ3({
        low: params.low,
        mid: params.mid,
        high: params.high,
        lowFrequency: params.lowFrequency,
        highFrequency: params.highFrequency,
      });
    case "compressor":
      return new CompressorChain(params);
    case "delay":
      return new DelayChain(params);
    case "reverb":
      return new ReverbChain(params);
    case "chorus":
      return new ChorusChain(params);
    case "distortion":
      return new SaturatorChain(params);
    case "filter":
      return new FilterChain(params);
    case "limiter":
      // Not Tone.Limiter (a native compressor): see lookaheadLimiter.ts.
      return new LookaheadLimiter({
        ceilingDb: params.threshold,
        gainDb: params.gain,
        release: params.release,
        softClip: params.softClip >= 0.5,
      });
    case "pitchShift":
      // Not Tone.PitchShift, which is out of tune - see pitchShifter.ts.
      return new PitchShifter({
        pitch: params.pitch,
        fine: params.fine,
        window: params.window,
        feedback: params.feedback,
        wet: params.wet,
      });
    case "irLoader":
      return new IrLoaderChain(params);
    case "namAmp":
      return new NamAmpChain(params);
    case "gate":
      return new NoiseGate(params);
    case "paramEq":
      return new ParamEqChain(params);
    case "multiband":
      return new MultibandChain(params);
    case "utility":
      return new UtilityChain(params);
    case "tuner":
      return new TunerChain(params);
    case "glue":
      return new GlueChain(params);
    case "tubeAmp":
      return new AmpSimChain(params);
    case "mbDynamics":
      return new MbDynamicsChain(params);
  }
}

export function applyEffectParam(
  node: Tone.ToneAudioNode,
  type: EffectType,
  key: string,
  value: number
): void {
  switch (type) {
    case "eq3": {
      const eq = node as Tone.EQ3;
      if (key === "low") eq.low.value = value;
      else if (key === "mid") eq.mid.value = value;
      else if (key === "high") eq.high.value = value;
      else if (key === "lowFrequency") eq.lowFrequency.value = value;
      else if (key === "highFrequency") eq.highFrequency.value = value;
      break;
    }
    case "compressor":
      (node as CompressorChain).setParam(key, value);
      break;
    case "delay": {
      const delay = node as DelayChain;
      if (key === "delayTimeL") delay.setDelayTimeL(value);
      else if (key === "delayTimeR") delay.setDelayTimeR(value);
      else if (key === "feedback") delay.setFeedback(value);
      else if (key === "lowCut") delay.setLowCut(value);
      else if (key === "highCut") delay.setHighCut(value);
      else if (key === "wet") delay.setWet(value);
      else if (key === "filterOn") delay.setFilterOn(value >= 0.5);
      else if (key === "pingPong") delay.setPingPong(value >= 0.5);
      else if (key === "freeze") delay.setFreeze(value >= 0.5);
      break;
    }
    case "reverb": {
      const reverb = node as ReverbChain;
      if (key === "preDelay") reverb.setPreDelay(value);
      else if (key === "decay") reverb.setDecay(value);
      else if (key === "damping") reverb.setDamping(value);
      else if (key === "early") reverb.setEarly(value);
      else if (key === "lowCut") reverb.setLowCut(value);
      else if (key === "highCut") reverb.setHighCut(value);
      else if (key === "width") reverb.setWidth(value);
      else if (key === "wet") reverb.setWet(value);
      else if (key === "mode") reverb.setMode(value);
      break;
    }
    case "chorus": {
      const chorus = node as ChorusChain;
      if (key === "frequency") chorus.setRate(value);
      else if (key === "delayTime") chorus.setDelay(value);
      else if (key === "depth") chorus.setDepth(value);
      else if (key === "feedback") chorus.setFeedback(value);
      else if (key === "spread") chorus.setSpread(value);
      else if (key === "wet") chorus.setWet(value);
      else if (key === "waveform") chorus.setWaveform(value);
      break;
    }
    case "distortion":
      (node as SaturatorChain).setParam(key, value);
      break;
    case "filter": {
      const filter = node as FilterChain;
      if (key === "frequency") filter.setFrequency(value);
      else if (key === "Q") filter.setQ(value);
      else if (key === "gain") filter.setGain(value);
      else if (key === "mode") filter.setMode(value);
      else if (key === "slope") filter.setSlope(value);
      else if (key === "lfoRate") filter.setLfoRate(value);
      else if (key === "lfoDepth") filter.setLfoDepth(value);
      else if (key === "wet") filter.setWet(value);
      // Automation recorded on the pre-plugin 0..1 "type" knob.
      else if (key === "type") filter.setMode(legacyFilterTypeToMode(value));
      break;
    }
    case "limiter": {
      const limiter = node as LookaheadLimiter;
      if (key === "threshold") limiter.setCeiling(value);
      else if (key === "gain") limiter.setGain(value);
      else if (key === "release") limiter.setRelease(value);
      else if (key === "softClip") limiter.setSoftClip(value >= 0.5);
      break;
    }
    case "pitchShift": {
      const shift = node as PitchShifter;
      if (key === "pitch") shift.setPitch(value);
      else if (key === "fine") shift.setFine(value);
      else if (key === "window") shift.setWindow(value);
      else if (key === "feedback") shift.setFeedback(value);
      else if (key === "wet") shift.setWet(value);
      break;
    }
    case "irLoader": {
      const ir = node as IrLoaderChain;
      if (key === "lowCut") ir.setLowCut(value);
      else if (key === "highCut") ir.setHighCut(value);
      else if (key === "output") ir.setOutput(value);
      else if (key === "wet") ir.setWet(value);
      else if (key === "normalize") ir.setNormalize(value >= 0.5);
      break;
    }
    case "namAmp": {
      const amp = node as NamAmpChain;
      if (key === "input") amp.setInput(value);
      else if (key === "bass" || key === "middle" || key === "treble") amp.setTone(key, value);
      else if (key === "output") amp.setOutput(value);
      else if (key === "normalize") amp.setNormalize(value >= 0.5);
      else if (key === "size") amp.setSize(value);
      break;
    }
    case "gate":
      (node as NoiseGate).setParam(key, value);
      break;
    case "paramEq":
      (node as ParamEqChain).setParam(key, value);
      break;
    case "multiband":
      (node as MultibandChain).setParam(key, value);
      break;
    case "utility":
      (node as UtilityChain).setParam(key, value);
      break;
    case "tubeAmp":
      (node as AmpSimChain).setParam(key, value);
      break;
    case "glue":
      (node as GlueChain).setParam(key, value);
      break;
    case "mbDynamics":
      (node as MbDynamicsChain).setParam(key, value);
      break;
    case "tuner":
      if (key === "mute") (node as TunerChain).setMute(value >= 0.5);
      break;
  }
}
