// Saving a graph as an image file, or copying it to the clipboard.
import { alert, pickSavePath, writeFile } from "../../native";
import { loadPlotly } from "./plotly";

export type ExportFormat = "png" | "jpeg" | "svg";
export const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPG" },
  { value: "svg", label: "SVG" },
];
const EXTENSION: Record<ExportFormat, string> = { png: "png", jpeg: "jpg", svg: "svg" };
// Plotly draws at 96 DPI; raster images are scaled up to ~300 DPI (print quality).
const RASTER_SCALE = 300 / 96;

// The folder of the last export, offered again for the next one this session.
let lastFolder: string | null = null;

type Size = { width: number; height: number };

// JPEG has no transparency: a transparent graph is drawn on white for it.
const WHITE = { paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff" };

async function toImage(el: HTMLElement, size: Size, format: ExportFormat) {
  const drawn = el as HTMLElement & { data: unknown[]; layout: object };
  const figure = format === "jpeg" ? { data: drawn.data, layout: { ...drawn.layout, ...WHITE } } : el;
  return (await loadPlotly()).toImage(figure, { format, ...size, scale: format === "svg" ? 1 : RASTER_SCALE });
}

const toBlob = async (dataUrl: string) => (await fetch(dataUrl)).blob();

export async function saveGraphImage(el: HTMLElement, size: Size, format: ExportFormat, name: string) {
  try {
    const dataUrl = await toImage(el, size, format);
    const ext = EXTENSION[format];
    const fileName = `${name}.${ext}`;
    const path = await pickSavePath("Export Graph", lastFolder ? `${lastFolder}/${fileName}` : fileName, ext.toUpperCase(), ext);
    if (!path) return;
    lastFolder = path.slice(0, path.lastIndexOf("/"));
    await writeFile(path, new Uint8Array(await (await toBlob(dataUrl)).arrayBuffer()));
  } catch (err) {
    alert("Couldn't export the graph", String(err), "error");
  }
}

/** Starts the clipboard write inside the click, with a promised image, as WebKit
 *  requires. Clipboard images must be raster: always PNG. */
export function copyGraphImage(el: HTMLElement, size: Size) {
  navigator.clipboard
    .write([new ClipboardItem({ "image/png": toImage(el, size, "png").then(toBlob) })])
    .catch((err) => alert("Couldn't copy the graph", String(err), "error"));
}
