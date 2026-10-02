import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dawn is one client page, so it ships as a static site (the out/ folder)
  // that any static host can serve; see docs/deploy.md.
  output: "export",
};

export default nextConfig;
