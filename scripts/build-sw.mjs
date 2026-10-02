// Writes public/sw.js from scripts/sw.template.js with a fresh build id,
// so every deploy is a new service worker (and triggers the update prompt).
// Runs before `next build` (see package.json).
import { readFileSync, writeFileSync } from "fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const id = `${pkg.version}-${Date.now().toString(36)}`;
const template = readFileSync(new URL("./sw.template.js", import.meta.url), "utf8");
writeFileSync(new URL("../public/sw.js", import.meta.url), template.replace("__BUILD_ID__", id));
console.log(`public/sw.js: build ${id}`);
