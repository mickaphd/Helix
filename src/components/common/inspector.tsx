// The inspector: the panel on the right of a graph (Format) or a grouped table (Groups),
// full height like the sidebar, and the building blocks its sections share.
import * as React from "react";
import { cn, IconButton } from "../../ui/controls";
import { ChevronRightIcon, PanelRightIcon } from "lucide-react";
import { SidePanel, Toolbar } from "../../ui/layout";
import { clampWidth, INSPECTOR_WIDTH, useLayout } from "../../store/use-layout";

/** A view with an inspector: its toolbar and content on the left, the inspector on the
 *  right. The inspector's button stays at the window's top right: in the inspector when
 *  it's shown, in the toolbar when it's hidden. */
export function WithInspector({
  title,
  tag,
  inspector,
  children,
}: {
  title: string;
  tag?: string;
  inspector: React.ReactNode;
  children: React.ReactNode;
}) {
  const { inspector: open, inspectorWidth, setLayout } = useLayout();
  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <Toolbar title={title} tag={tag} actions={!open && <InspectorToggle />} />
        {children}
      </div>
      <SidePanel
        side="right"
        open={open}
        width={inspectorWidth}
        minWidth={INSPECTOR_WIDTH.min}
        onResize={(width, open) => setLayout({ inspector: open, inspectorWidth: clampWidth(width, INSPECTOR_WIDTH) })}
        header={<InspectorToggle />}
      >
        {inspector}
      </SidePanel>
    </div>
  );
}

/** Shows or hides the inspector (also View ▸ Show Inspector, ⌥⌘I). */
function InspectorToggle() {
  const { inspector, setLayout } = useLayout();
  return (
    <IconButton
      aria-label={inspector ? "Hide Inspector" : "Show Inspector"}
      aria-pressed={inspector}
      onClick={() => setLayout({ inspector: !inspector })}
    >
      <PanelRightIcon />
    </IconButton>
  );
}

/** A titled inspector group with a hairline divider. With `onToggle`, clicking
 *  the title collapses or expands it. */
export function Section({
  title,
  action,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-separator px-3 py-3 last:border-b-0">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onToggle}
          disabled={!onToggle}
          className="flex items-center gap-1 text-small-strong uppercase tracking-wide text-primary"
        >
          {onToggle && (
            <ChevronRightIcon className={cn("size-3.5 text-secondary transition-transform", !collapsed && "rotate-90")} />
          )}
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
