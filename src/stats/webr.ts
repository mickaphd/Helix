// WebR engine — R compiled to WASM, running in a Web Worker so the UI never
// blocks. The app has ONE: it lives in a hidden window (engine.ts), and project
// windows send it their R code (`connectR`). Tests and `npm run web` run R here.
// The WebR library is loaded only when R starts, so project windows never carry it.
// R packages beyond R's own ship with the app (r-packages.json); the first time code asks
// for one with `library()`, its archive is mounted, as is, in a library of R's.
import type { WebR } from "webr";
import R_PACKAGES from "./r-packages.json";

/** An R result: a named numeric vector, non-finite values as `null`. */
export type RVector = Record<string, number | null>;

let engine: Promise<WebR> | null = null;
let remote: ((code: string) => Promise<RVector>) | null = null;

const PACKAGES = new Map(R_PACKAGES.map((p): [string, { version: string; depends?: string[] }] => [p.name, p]));
const LIBRARY = "/helix/library";
const installed = new Map<string, Promise<void>>();
let packagesUrl: string | undefined;

/** Start (or reuse) the R runtime. A failed boot is retried on the next call.
 *  `baseUrl` locates the R files and `packages` the shipped packages: served by the
 *  app, or folders when run by the tests. */
export function startR(baseUrl = "/webr/", packages?: string): Promise<WebR> {
  if (packages) packagesUrl = packages;
  return (engine ??= (async () => {
    const { WebR } = await import("webr");
    const webR = new WebR({ baseUrl });
    await webR.init();
    await webR.evalRVoid(`dir.create("${LIBRARY}",recursive=TRUE);.libPaths(c("${LIBRARY}",.libPaths()))`);
    return webR;
  })().catch((err) => {
    engine = null;
    throw err;
  }));
}

/** Installs package `name`, after those it depends on, the first time it is asked for. */
function install(webR: WebR, name: string): Promise<void> {
  let done = installed.get(name);
  if (!done) {
    const { version, depends = [] } = PACKAGES.get(name)!;
    done = (async () => {
      for (const d of depends) await install(webR, d);
      const from = packagesUrl ?? new URL("/webr/packages/", location.href).href;
      await webR.evalRVoid(`webr::mount("${LIBRARY}/${name}","${from}${name}_${version}.tgz")`);
    })();
    done.catch(() => installed.delete(name)); // asking again retries
    installed.set(name, done);
  }
  return done;
}

/** From now on, `evalNamedVector` hands its code to `evaluate` (the app's engine). */
export function connectR(evaluate: (code: string) => Promise<RVector>) {
  remote = evaluate;
}

/**
 * Evaluate R code that returns a named numeric vector, marshalled to a plain
 * `{ name: value }` map. The single primitive every analysis builds on. `local()`
 * gives each run a fresh environment, so analyses can never read each other's variables.
 */
export async function evalNamedVector(code: string): Promise<RVector> {
  if (remote) return remote(code);
  const webR = await startR();
  for (const [, name] of code.matchAll(/library\((\w+)\)/g)) if (PACKAGES.has(name)) await install(webR, name);
  const shelter = await new webR.Shelter();
  try {
    const result = await shelter.evalR(`local({${code}})`).catch((err: unknown) => {
      // R says "Error in `call`: reason". The call is our generated code: keep the reason.
      throw new Error(String(err instanceof Error ? err.message : err).replace(/^Error in `[^`]*`\s*:\s*/, ""));
    });
    const { names, values } = (await result.toJs()) as { names: string[] | null; values: number[] };
    const out: RVector = {};
    (names ?? []).forEach((name, i) => {
      out[name] = Number.isFinite(values[i]) ? values[i] : null;
    });
    return out;
  } finally {
    shelter.purge();
  }
}
