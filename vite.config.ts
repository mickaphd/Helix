import { cpSync, createReadStream, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";

// WebR loads its R runtime (WASM + worker + virtual filesystem) at run time
// from a base URL. Serve those files at /webr/ in dev and copy them into the
// build; the rest of the package (REPL, tests, source maps) is left out.
const WEBR_DIST = resolve("node_modules/webr/dist");
const WEBR_RUNTIME = ["R.js", "R.wasm", "libRblas.so", "libRlapack.so", "webr-worker.js", "vfs"];
const MIME: Record<string, string> = { ".js": "text/javascript", ".wasm": "application/wasm" };

function webrRuntime(): Plugin {
  return {
    name: "webr-runtime",
    // Served as-is: Vite must not transform the worker script.
    configureServer(server) {
      server.middlewares.use("/webr", (req, res, next) => {
        const file = resolve(WEBR_DIST, `.${decodeURIComponent(req.url!.split("?")[0])}`);
        if (!file.startsWith(WEBR_DIST) || !statSync(file, { throwIfNoEntry: false })?.isFile()) return next();
        res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
    writeBundle({ dir }) {
      for (const f of WEBR_RUNTIME) cpSync(resolve(WEBR_DIST, f), resolve(dir!, "webr", f), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss(), webrRuntime()],
  clearScreen: false,
  // The native side is rebuilt by Tauri; its build output must not reload the page.
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: { target: "safari16", chunkSizeWarningLimit: 5000 },
});
