# NAM engine (vendored)

`nam-worklet.js` and `nam-engine.wasm` are copied unmodified from the
`neural-amp-modeler-wasm` npm package, version 2.0.1 (`dist/engine/`), by
TONE3000 - a WebAssembly build of Steven Atkinson's NeuralAmpModelerCore
(NAM core v0.5.4, with A2 / slimmable model support). Both are MIT licensed;
see the LICENSE files here.

They're vendored rather than installed because the package's React 18 peer
dependency conflicts with this app's React 19, and only these two engine
files are used. The app talks to the worklet directly through its message
protocol (see src/lib/namEngine.ts). To update: copy the same two files from
a newer release of the package and check its protocol hasn't changed.
