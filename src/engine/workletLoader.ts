import type * as Tone from "tone";

// AudioWorklet modules, loaded once per audio context. Offline renders (WAV
// export) must await `workletsReady` before rendering, so every worklet
// node created during setup is actually in the graph by then.

const moduleUrls = new Map<string, string>();
const loads = new WeakMap<object, Map<string, Promise<void>>>();

/** Loads worklet `code` (which registers its own processor) into `context`
 * the first time it's asked for there. */
export function loadWorklet(context: Tone.BaseContext, key: string, code: string): Promise<void> {
  const raw = context.rawContext;
  let perContext = loads.get(raw);
  if (!perContext) {
    perContext = new Map();
    loads.set(raw, perContext);
  }
  let promise = perContext.get(key);
  if (!promise) {
    let url = moduleUrls.get(key);
    if (!url) {
      url = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
      moduleUrls.set(key, url);
    }
    promise = raw.audioWorklet!.addModule(url);
    perContext.set(key, promise);
  }
  return promise;
}

/** Resolves once every worklet module requested in `context` so far has
 * loaded. */
export function workletsReady(context: Tone.BaseContext): Promise<void> {
  const perContext = loads.get(context.rawContext);
  return Promise.all(perContext ? [...perContext.values()] : []).then(() => undefined);
}
