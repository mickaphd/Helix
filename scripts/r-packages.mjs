// The R packages Helix ships beyond R's own (src/stats/r-packages.json: name, version,
// SHA-256), downloaded once from WebR's repository into r-packages/, built for the R
// that WebR runs. `npm install` runs it; a file already there with the right hash is
// kept, one with another hash is refused, and one no longer listed (an older version) is
// removed, so it never ships. Vite serves the folder and copies it into
// the app; R installs a package the first time code asks for it (stats/webr.ts).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const REPO = "https://repo.r-wasm.org/bin/emscripten/contrib/4.6/";
const DIR = "r-packages";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const packages = JSON.parse(readFileSync("src/stats/r-packages.json", "utf8"));
mkdirSync(DIR, { recursive: true });
const listed = new Set(packages.map(({ name, version }) => `${name}_${version}.tgz`));
for (const file of readdirSync(DIR)) if (!listed.has(file)) rmSync(`${DIR}/${file}`, { recursive: true });
for (const { name, version, sha256: expected } of packages) {
  const file = `${DIR}/${name}_${version}.tgz`;
  if (existsSync(file) && sha256(readFileSync(file)) === expected) continue;
  const response = await fetch(REPO + `${name}_${version}.tgz`);
  if (!response.ok) throw new Error(`Couldn't download the R package ${name} ${version}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== expected) throw new Error(`The R package ${name} ${version} isn't the one expected.`);
  writeFileSync(file, bytes);
  console.log(`R package ${name} ${version} downloaded.`);
}
