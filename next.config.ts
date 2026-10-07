import type { NextConfig } from "next";
import { existsSync } from "fs";
import { version } from "./package.json";

const nextConfig: NextConfig = {
  // Dawn is one client page, so it ships as a static site (the out/ folder)
  // that any static host can serve; see docs/deploy.md.
  output: "export",
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    // Whether there's a demo song to offer (src/project/demoSong.ts).
    NEXT_PUBLIC_HAS_DEMO_SONG: existsSync("public/demo/demo-song.dawnproject") ? "1" : "",
  },
};

export default nextConfig;
