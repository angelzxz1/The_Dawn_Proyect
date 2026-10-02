import type { NextConfig } from "next";
import { version } from "./package.json";

const nextConfig: NextConfig = {
  // Dawn is one client page, so it ships as a static site (the out/ folder)
  // that any static host can serve; see docs/deploy.md.
  output: "export",
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
};

export default nextConfig;
