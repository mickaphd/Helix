// WebR engine — R compiled to WASM, running in a Web Worker so the UI never
// blocks. The app has ONE: it lives in a hidden window (engine.ts), and project
// windows send it their R code (`connectR`). Tests and `npm run web` run R here.
// The WebR library is loaded only when R starts, so project windows never carry it.
import type { WebR } from "webr";

/** An R result: a named numeric vector, non-finite values as `null`. */
export type RVector = Record<string, number | null>;

let engine: Promise<WebR> | null = null;
let remote: ((code: string) => Promise<RVector>) | null = null;

/** Start (or reuse) the R runtime. A failed boot is retried on the next call.
 *  `baseUrl` locates the R files: served by the app, or a folder when run by the tests. */
export function startR(baseUrl = "/webr/"): Promise<WebR> {
  return (engine ??= (async () => {
    const { WebR } = await import("webr");
    const webR = new WebR({ baseUrl });
    await webR.init();
    return webR;
  })().catch((err) => {
    engine = null;
    throw err;
  }));
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
