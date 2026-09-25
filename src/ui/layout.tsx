// Window layout: side panels (sidebar, inspector), toolbars, and sidebar rows. The
// window's title bar is hidden (see tauri.conf.json), so the panel tops and every
// toolbar double as drag areas; the traffic lights sit centered in them.
import * as React from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "./controls";

/** Top bar of a pane: a title, a tag saying what it is (a gray pill, left out when the
 *  title already says it), and buttons on the right.
 *  Dragging it moves the window. Its left inset is `--toolbar-inset`: room for the
 *  traffic lights when the sidebar is hidden. */
export function Toolbar({ title, tag, actions }: { title: string; tag?: string; actions?: React.ReactNode }) {
  return (
    <div
      data-tauri-drag-region
      className="flex h-13 shrink-0 items-center gap-2 pr-3 pl-[var(--toolbar-inset,16px)] transition-[padding] duration-200"
    >
      <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-2">
        <h1 className="truncate text-strong">{title}</h1>
        {tag && tag !== title && (
          <span className="shrink-0 rounded-full bg-control px-2 py-0.5 text-small-strong text-secondary">{tag}</span>
        )}
      </div>
      {actions}
    </div>
  );
}

/** A full-height panel on one side of the window: the sidebar (left) or the inspector
 *  (right), `width` wide, or folded away. Its inner edge drags to resize, like a native
 *  split view: `onResize` gets the wanted width, and folds the panel when it is dragged
 *  past half its minimum (back to its width before the drag, for when it opens again).
 *  The content keeps its width while folding. The header holds the panel's button, at
 *  its right end. */
export function SidePanel({
  side,
  open,
  width,
  minWidth,
  onResize,
  header,
  footer,
  children,
}: {
  side: "left" | "right";
  open: boolean;
  width: number;
  minWidth: number;
  onResize: (width: number, open: boolean) => void;
  header: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [resizing, setResizing] = React.useState(false);
  const start = React.useRef({ x: 0, width });
  const resizeTo = (e: React.PointerEvent) => {
    const moved = side === "left" ? e.clientX - start.current.x : start.current.x - e.clientX;
    const wanted = start.current.width + moved;
    if (wanted < minWidth / 2) onResize(start.current.width, false);
    else onResize(wanted, true);
  };
  // The resize cursor stays on while the pointer strays over other elements.
  const setResizingTo = (on: boolean) => {
    setResizing(on);
    document.body.style.cursor = on ? "col-resize" : "";
  };

  return (
    <aside
      inert={!open && !resizing}
      style={{ width: open ? width : 0 }}
      className={cn(
        "relative flex shrink-0 overflow-hidden",
        side === "right" && "justify-end",
        open && (side === "left" ? "border-r border-separator" : "border-l border-separator"),
        !resizing && "transition-[width] duration-200",
      )}
    >
      <div style={{ width }} className="flex h-full shrink-0 flex-col">
        <div data-tauri-drag-region className="flex h-13 shrink-0 items-center justify-end px-3">
          {header}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="shrink-0 px-2 py-2">{footer}</div>}
      </div>
      <div
        className={cn("absolute inset-y-0 w-1.5 cursor-col-resize", side === "left" ? "right-0" : "left-0")}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = { x: e.clientX, width };
          setResizingTo(true);
        }}
        onPointerMove={(e) => resizing && resizeTo(e)}
        onPointerUp={() => setResizingTo(false)}
        onPointerCancel={() => setResizingTo(false)}
      />
    </aside>
  );
}

type SidebarItemProps = Omit<React.ComponentProps<"div">, "title"> & {
  icon: React.ReactNode;
  title: string;
  selected: boolean;
  /** Whether its children show, for a row that has some. */
  open?: boolean;
  onToggle?: () => void;
};

/** A sidebar row. With children, it gets a disclosure triangle. The selected row is
 *  gray, and blue while the sidebar has the keyboard (as in the Finder); its list is
 *  the `group` that holds the focus. */
export function SidebarItem({ icon, title, selected, open = true, onToggle, children, className, ...props }: SidebarItemProps) {
  const hasChildren = React.Children.count(children) > 0;
  return (
    <>
      <div
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-md pr-2 pl-1 text-regular",
          selected && "bg-separator group-focus:bg-accent group-focus:text-white",
          className,
        )}
        {...props}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? "Collapse" : "Expand"}
          onClick={onToggle}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn("text-secondary", selected && "group-focus:text-white", !hasChildren && "invisible")}
        >
          <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
        <span className={cn("text-secondary", selected && "group-focus:text-white")}>{icon}</span>
        <span className="truncate" title={title}>
          {title}
        </span>
      </div>
      {hasChildren && open && <div className="pl-4">{children}</div>}
    </>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div data-tauri-drag-region className="flex h-full flex-col items-center justify-center gap-1">
      <p className="text-strong">{title}</p>
      <p className="text-regular text-secondary">{description}</p>
    </div>
  );
}
