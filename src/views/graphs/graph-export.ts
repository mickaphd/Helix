// Saving a graph as an image file, or copying it to the clipboard.
import { alert, pickSavePath, writeFile } from "../../native";
import { loadPlotly } from "./plotly";
import { withoutSelection } from "./selection";
import { withDpi } from "../../lib/image-dpi";

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
// Plotly draws a pixel per 1/96 inch: the size typed, in px, is the printed size.
const PLOTLY_DPI = 96;

// The folder of the last export, offered again for the next one this session.
let lastFolder: string | null = null;

type Size = { width: number; height: number };

// JPEG has no transparency: a transparent graph is drawn on white for it.
const WHITE = { paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff" };

/** The drawn graph as an image, without the selection ring; a raster one at `dpi`. */
async function toImage(el: HTMLElement, size: Size, format: ExportFormat, dpi: Resolution) {
  const drawn = el as HTMLElement & { data: unknown[]; layout: object };
  const layout = format === "jpeg" ? { ...drawn.layout, ...WHITE } : drawn.layout;
  const figure = { data: withoutSelection(drawn.data), layout };
  const scale = format === "svg" ? 1 : Number(dpi) / PLOTLY_DPI;
  const url = await (await loadPlotly()).toImage(figure, { format, ...size, scale });
  const image = await (await fetch(url)).blob();
  return format === "svg" ? image : withDpi(new Uint8Array(await image.arrayBuffer()), format, Number(dpi));
}

export async function saveGraphImage(el: HTMLElement, size: Size, format: ExportFormat, dpi: Resolution, name: string) {
  try {
    const image = await toImage(el, size, format, dpi);
    const ext = EXTENSION[format];
    const fileName = `${name}.${ext}`;
    const path = await pickSavePath("Export Graph", lastFolder ? `${lastFolder}/${fileName}` : fileName, ext.toUpperCase(), ext);
    if (!path) return;
    lastFolder = path.slice(0, path.lastIndexOf("/"));
    await writeFile(path, new Uint8Array(await image.arrayBuffer()));
  } catch (err) {
    alert("Couldn't export the graph", String(err), "error");
  }
}

/** Starts the clipboard write inside the click, with a promised image, as WebKit
 *  requires. Clipboard images must be raster: always PNG. */
export function copyGraphImage(el: HTMLElement, size: Size, dpi: Resolution) {
  navigator.clipboard
    .write([new ClipboardItem({ "image/png": toImage(el, size, "png", dpi) })])
    .catch((err) => alert("Couldn't copy the graph", String(err), "error"));
}
