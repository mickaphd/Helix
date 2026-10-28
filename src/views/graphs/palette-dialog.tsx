// New Palette… and Edit Palette…: a palette of My Palettes, made from the graph's own
// colors or changed. Each color is a swatch picked in macOS's Colors panel
// (`<input type="color">`); − removes the chosen one, + copies it after itself.
import * as React from "react";
import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { Dialog } from "../../ui/dialog";
import { Button, Field, Input, Segmented, cn } from "../../ui/controls";
import { isHelixPalette, paletteBackground, paletteColor } from "../../lib/palettes";
import { deletePalette, keepPalette } from "../../store/my-palettes";
import { confirmDelete } from "../../native";
import type { GraphPalette, PaletteKind } from "../../store/types";

const COLORS = { min: 2, max: 12 };

/** What the window starts from: a palette, the Mac's others, and the name of the one
 *  being edited. */
export interface PaletteDraft {
  palette: GraphPalette;
  mine: GraphPalette[];
  editing?: string;
}

/** A new palette from the graph's: its colors, or 3 along a long gradient. */
export const draftFrom = (palette: GraphPalette, mine: GraphPalette[]): PaletteDraft => ({
  palette: {
    ...palette,
    colors: palette.colors.length <= COLORS.max ? palette.colors : [0, 1, 2].map((i) => paletteColor(palette, i, 3)),
  },
  mine,
});

const KINDS = [
  { value: "categorical", label: "Colors" },
  { value: "sequential", label: "Gradient" },
] as const;

export function PaletteDialog({
  draft: { palette, mine, editing },
  gradients,
  onClose,
  onDone,
}: {
  draft: PaletteDraft;
  /** Only gradients (a heatmap's). */
  gradients: boolean;
  onClose: () => void;
  onDone: (palette: GraphPalette) => void;
}) {
  const [name, setName] = React.useState(editing ?? "");
  const [kind, setKind] = React.useState<PaletteKind>(gradients ? "sequential" : palette.kind);
  const [colors, setColors] = React.useState(palette.colors);
  const [chosen, setChosen] = React.useState(0);

  const made = { name: name.trim(), kind, colors };
  const taken =
    isHelixPalette(made.name) ||
    mine.some((p) => p.name !== editing && p.name.toLowerCase() === made.name.toLowerCase());
  const done = async () => {
    if (!made.name || taken || !(await keepPalette(made, editing))) return;
    onDone(made);
    onClose();
  };
  const remove = async () => {
    if (!(await confirmDelete(`Delete “${editing}”?`, "Graphs that use it keep their colors."))) return;
    if (await deletePalette(editing!)) onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      onReturn={() => void done()}
      title={editing ? "Edit Palette" : "New Palette"}
      start={editing && <Button onClick={() => void remove()}>Delete Palette…</Button>}
      footer={
        <Button variant="accent" disabled={!made.name || taken} onClick={() => void done()}>
          {editing ? "Save" : "Create"}
        </Button>
      }
    >
      <Field label="Name">
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {!gradients && (
        <Field label="Type">
          <Segmented
            value={kind === "categorical" ? "categorical" : "sequential"}
            onChange={setKind}
            options={[...KINDS]}
          />
        </Field>
      )}
      <div className="flex items-center gap-1">
        <div className="flex flex-1 flex-wrap gap-1.5">
          {colors.map((c, i) => (
            <input
              key={i}
              type="color"
              aria-label={`Color ${i + 1}`}
              value={c.toLowerCase()}
              onClick={() => setChosen(i)}
              onChange={(e) => setColors(colors.with(i, e.target.value.toUpperCase()))}
              className={cn(
                "size-6 cursor-pointer appearance-none rounded-full bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-edge [&::-webkit-color-swatch-wrapper]:p-0",
                i === chosen && "ring-2 ring-accent ring-offset-1 ring-offset-surface",
              )}
            />
          ))}
        </div>
        <Button
          size="icon"
          aria-label="Remove color"
          disabled={colors.length <= COLORS.min}
          onClick={() => {
            setColors(colors.toSpliced(chosen, 1));
            setChosen(Math.min(chosen, colors.length - 2));
          }}
        >
          <MinusIcon className="size-3.5" />
        </Button>
        <Button
          size="icon"
          aria-label="Add color"
          disabled={colors.length >= COLORS.max}
          onClick={() => {
            setColors(colors.toSpliced(chosen + 1, 0, colors[chosen]));
            setChosen(chosen + 1);
          }}
        >
          <PlusIcon className="size-3.5" />
        </Button>
      </div>
      <div
        className="h-5 rounded-md border border-edge bg-origin-border"
        style={{ backgroundImage: paletteBackground(made) }}
      />
      {taken && <p className="text-small text-secondary">A palette already has this name.</p>}
    </Dialog>
  );
}
