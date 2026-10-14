// The demo song: a project made in Dawn, exported with File → Export
// Project File… and placed at public/demo/demo-song.dawnproject (see
// docs/deploy.md). It loads on the first visit and from the start screen.
// Until the file exists, everything that offers it stays hidden.

export const DEMO_SONG_URL = "/demo/demo-song.dawnproject";

/** Whether this build has a demo song (found when it was built). */
export function demoSongAvailable(): Promise<boolean> {
  return Promise.resolve(process.env.NEXT_PUBLIC_HAS_DEMO_SONG === "1");
}

export async function fetchDemoSong(): Promise<Blob> {
  const r = await fetch(DEMO_SONG_URL);
  if (!r.ok) throw new Error(`the demo song didn't download (${r.status})`);
  return r.blob();
}
