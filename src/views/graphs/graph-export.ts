// Saving a graph as an image file, or copying it to the clipboard.
import { alert, pickSavePath, writeFile } from "../../native";
import { loadPlotly } from "./plotly";
import { withoutSelection } from "./selection";
import { vectorTraces } from "./plot-helpers";
import { largestAt, PX_PER_INCH, withDpi } from "../../lib/image-dpi";

export type ExportFormat = "png" | "jpeg" | "svg";
export const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPG" },
  { value: "svg", label: "SVG" },
];
const EXTENSION: Record<ExportFormat, string> = { png: "png", jpeg: "jpg", svg: "svg" };
/** A raster image's resolution, in dots per inch (SVG has none). */
export const RESOLUTIONS = ["150", "300", "600"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

// The folder of the last export, offered again for the next one this session.
let lastFolder: string | null = null;

type Size = { width: number; height: number };

// JPEG has no transparency: a transparent graph is drawn on white for it.
const WHITE = { paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff" };

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Why a raster image of the graph at `dpi` isn't made, if it isn't: told before drawing,
 *  as too large an image would hold up the whole Mac, or fail. */
function tooLarge(size: Size, dpi: Resolution) {
  const most = largestAt(size, Number(dpi));
  if (most.width < size.width) {
    return `At ${dpi} DPI, the largest graph Helix exports is ${most.width} × ${most.height} px. Choose a lower resolution, or make the graph smaller.`;
  }
}

/** The drawn graph as an image, without the selection ring, its points as sharp shapes;
 *  a raster one at `dpi`. */
async function toImage(el: HTMLElement, size: Size, format: ExportFormat, dpi: Resolution) {
  const drawn = el as HTMLElement & { data: unknown[]; layout: object };
  const layout = format === "jpeg" ? { ...drawn.layout, ...WHITE } : drawn.layout;
  const figure = { data: vectorTraces(withoutSelection(drawn.data)), layout };
  const scale = format === "svg" ? 1 : Number(dpi) / PX_PER_INCH;
  const url = await (await loadPlotly()).toImage(figure, { format, ...size, scale });
  const image = await (await fetch(url)).blob();
  return format === "svg" ? image : withDpi(new Uint8Array(await image.arrayBuffer()), format, Number(dpi));
}

export async function saveGraphImage(el: HTMLElement, size: Size, format: ExportFormat, dpi: Resolution, name: string) {
  const why = format !== "svg" && tooLarge(size, dpi);
  if (why) return alert("Couldn't Export the Graph", why, "error");
  try {
    const image = await toImage(el, size, format, dpi);
    const ext = EXTENSION[format];
    const fileName = `${name}.${ext}`;
    const path = await pickSavePath(
      "Export Graph",
      lastFolder ? `${lastFolder}/${fileName}` : fileName,
      ext.toUpperCase(),
      ext,
    );
    if (!path) return;
    lastFolder = path.slice(0, path.lastIndexOf("/"));
    await writeFile(path, new Uint8Array(await image.arrayBuffer()));
  } catch (err) {
    alert("Couldn't Export the Graph", reason(err), "error");
  }
}

/** Starts the clipboard write inside the click, with a promised image, as WebKit
 *  requires. Clipboard images must be raster: always PNG. */
export function copyGraphImage(el: HTMLElement, size: Size, dpi: Resolution) {
  const why = tooLarge(size, dpi);
  if (why) return void alert("Couldn't Copy the Graph", why, "error");
  navigator.clipboard
    .write([new ClipboardItem({ "image/png": toImage(el, size, "png", dpi) })])
    .catch((err) => alert("Couldn't Copy the Graph", reason(err), "error"));
}
