// WebR engine — R compiled to WASM, running in a Web Worker so the UI never
// blocks. One instance, booted in the background at launch (see main.tsx) so
// it's ready by the first analysis.
import { WebR } from "webr";

let engine: Promise<WebR> | null = null;

/** Start (or reuse) the R runtime. A failed boot is retried on the next call.
 *  `baseUrl` locates the R files: served by the app, or a folder when run by the tests. */
export function startR(baseUrl = "/webr/"): Promise<WebR> {
  return (engine ??= (async () => {
    const webR = new WebR({ baseUrl });
    await webR.init();
    return webR;
  })().catch((err) => {
    engine = null;
    throw err;
  }));
}

/**
 * Evaluate R code that returns a named numeric vector, marshalled to a plain
 * `{ name: value }` map (non-finite R results → `null`). The single primitive
 * every analysis builds on. `local()` gives each run a fresh environment, so
 * concurrent analyses can never read each other's variables.
 */
export async function evalNamedVector(code: string): Promise<Record<string, number | null>> {
  const webR = await startR();
  const shelter = await new webR.Shelter();
  try {
    const result = await shelter.evalR(`local({${code}})`).catch((err: unknown) => {
      // R says "Error in `call`: reason". The call is our generated code: keep the reason.
      throw new Error(String(err instanceof Error ? err.message : err).replace(/^Error in `[^`]*`\s*:\s*/, ""));
    });
    const { names, values } = (await result.toJs()) as { names: string[] | null; values: number[] };
    const out: Record<string, number | null> = {};
    (names ?? []).forEach((name, i) => {
      out[name] = Number.isFinite(values[i]) ? values[i] : null;
    });
    return out;
  } finally {
    shelter.purge();
  }
}
