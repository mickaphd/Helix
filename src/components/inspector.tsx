// The right panel: each item's note, or a graph's or a grouped table's settings (Format,
// Groups), full height like the sidebar, and the building blocks its sections share.
import * as React from "react";
import { Button, cn, IconButton } from "../ui/controls";
import {
  CaretRightIcon,
  MinusIcon,
  NoteBlankIcon,
  NoteIcon,
  PlusIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import { SidePanel, Toolbar } from "../ui/layout";
import { clampWidth, INSPECTOR_WIDTH, useLayout } from "../store/use-layout";
import { clamp, type ProjectNode } from "../store/types";
import { useProjectActions } from "../store/use-project-store";

type View = "notes" | "settings";

/** A view with the right panel: its toolbar and content on the left, the panel on the right,
 *  showing the item's note or its `settings` (where it has some). The panel's two buttons,
 *  Notes then Settings, stay at the window's top right: in the panel when it's shown, in the
 *  toolbar when it's hidden. */
export function WithInspector({
  title,
  tag,
  node,
  settings,
  children,
}: {
  title: string;
  tag?: string;
  node: ProjectNode;
  settings?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { inspector: open, panel, inspectorWidth, setLayout, setInspectorHere, setSettingsHere } = useLayout();
  const hasSettings = settings !== undefined;
  // While shown, the window keeps room for the panel in its layout (`fitWidths`), and the
  // View menu offers the settings where there are some.
  React.useLayoutEffect(() => {
    setInspectorHere(true);
    setSettingsHere(hasSettings);
    return () => {
      setInspectorHere(false);
      setSettingsHere(false);
    };
  }, [setInspectorHere, setSettingsHere, hasSettings]);
  const shown: View = panel === "settings" && hasSettings ? "settings" : "notes";
  const buttons = <PanelButtons shown={open ? shown : null} hasNote={Boolean(node.notes)} hasSettings={hasSettings} />;
  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <Toolbar title={title} tag={tag} actions={!open && buttons} />
        {children}
      </div>
      <SidePanel
        side="right"
        open={open}
        width={inspectorWidth}
        minWidth={INSPECTOR_WIDTH.min}
        onResize={(width, open) => setLayout({ inspector: open, inspectorWidth: clampWidth(width, INSPECTOR_WIDTH) })}
        header={buttons}
      >
        {shown === "settings" ? settings : <Notes node={node} />}
      </SidePanel>
    </div>
  );
}

/** Notes, then Settings (also View ▸ Show Notes ⌥⌘N, Show Inspector ⌥⌘I): each shows the
 *  panel with its view, or hides it when shown (gray, as the sidebar's button). The note's icon has
 *  lines once the item has a note. */
function PanelButtons({ shown, hasNote, hasSettings }: { shown: View | null; hasNote: boolean; hasSettings: boolean }) {
  const { setLayout } = useLayout();
  const button = (view: View, label: string, icon: React.ReactNode, enabled = true) => (
    <IconButton
      aria-label={`${shown === view ? "Hide" : "Show"} ${label}`}
      aria-pressed={shown === view}
      disabled={!enabled}
      onClick={() => setLayout(shown === view ? { inspector: false } : { inspector: true, panel: view })}
    >
      {icon}
    </IconButton>
  );
  return (
    <div className="flex gap-1">
      {button("notes", "Notes", hasNote ? <NoteIcon /> : <NoteBlankIcon />)}
      {button("settings", "Inspector", <SlidersHorizontalIcon />, hasSettings)}
    </div>
  );
}

/** The item's note: plain text, saved in the project as it is typed (one Undo step for a
 *  burst of typing; ⌘Z in the field is the field's own). */
function Notes({ node }: { node: ProjectNode }) {
  const { setNotes } = useProjectActions();
  return (
    <textarea
      aria-label="Notes"
      value={node.notes ?? ""}
      onChange={(e) => setNotes(node.id, e.target.value)}
      placeholder="Write a note…"
      className="block h-full w-full resize-none bg-transparent px-3 py-2 text-regular outline-none placeholder:text-secondary"
    />
  );
}

/** A titled inspector group with a hairline divider. With `onToggle`, clicking
 *  the title collapses or expands it (`all`: with ⌥, its siblings too). */
export function Section({
  title,
  icon,
  action,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  /** Shown before the title, as the sidebar's icons. */
  icon?: React.ReactNode;
  action?: React.ReactNode;
  collapsed?: boolean;
  onToggle?: (all: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-separator px-3 py-3 last:border-b-0">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={(e) => onToggle?.(e.altKey)}
          disabled={!onToggle}
          className="flex items-center gap-1.5 text-small-strong uppercase tracking-wide text-primary"
        >
          {onToggle && (
            <CaretRightIcon className={cn("size-3.5 text-secondary transition-transform", !collapsed && "rotate-90")} />
          )}
          {icon && <span className="text-secondary [&_svg]:size-4">{icon}</span>}
          {title}
        </button>
        {action}
      </div>
      {!collapsed && <div className="flex flex-col gap-2">{children}</div>}
    </div>
  );
}

/** A stacked label + control row. The label names the controls for VoiceOver. */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-1">
      <span id={id} className="text-small text-secondary">
        {label}
      </span>
      {children}
    </div>
  );
}

/** A minimalist −/value/+ stepper (native +/- buttons) for a bounded numeric option.
 *  `step` may be fractional, so results are rounded to avoid float drift (0.5 + 0.5 …). */
export function Stepper({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const round = (n: number) => Math.round(n / step) * step;
  return (
    <div className="flex items-center justify-between">
      <span className="text-small text-secondary">{label}</span>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          disabled={value <= min}
          onClick={() => onChange(clamp(round(value - step), { min, max }))}
          aria-label={`Decrease ${label.toLowerCase()}`}
        >
          <MinusIcon className="size-3.5" />
        </Button>
        <span className="w-9 text-center text-small tabular-nums">{value}</span>
        <Button
          size="icon"
          disabled={value >= max}
          onClick={() => onChange(clamp(round(value + step), { min, max }))}
          aria-label={`Increase ${label.toLowerCase()}`}
        >
          <PlusIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
