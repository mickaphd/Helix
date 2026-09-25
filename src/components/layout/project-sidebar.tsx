import * as React from "react";
import { CirclePlusIcon, TableIcon, SigmaIcon, LineChartIcon, PanelLeftIcon } from "lucide-react";
import { Button, IconButton } from "../../ui/controls";
import { PromptDialog } from "../../ui/dialog";
import { SidePanel, SidebarItem } from "../../ui/layout";
import { popupMenu } from "../../native";
import { useProjectStore, type ProjectNode } from "../../store/use-project-store";
import { useOpenAnalysisPicker } from "../../views/analyses/use-analysis-launcher";
import { useOpenGraphPicker } from "../../views/graphs/use-graph-launcher";
import { removeWithConfirm } from "../../store/use-document";
import { clampWidth, SIDEBAR_WIDTH, useLayout } from "../../store/use-layout";

/** What's currently being dragged. Tables reorder among tables; children reorder
 *  only among siblings of the same table (never across tables, never into a table). */
type DragInfo = { kind: "table" | "child"; id: string; parentId: string | null };
type DropTarget = { id: string; position: "before" | "after" };
type RowDnd = { id: string; onPointerDown: (e: React.PointerEvent) => void };

/** Move `sourceId` to just before/after `targetId` within an ordered id list. */
function move(
  order: string[],
  sourceId: string,
  targetId: string,
  position: "before" | "after",
): string[] {
  const without = order.filter((id) => id !== sourceId);
  const targetIdx = without.indexOf(targetId);
  if (targetIdx === -1) return order;
  const insertAt = position === "before" ? targetIdx : targetIdx + 1;
  return [...without.slice(0, insertAt), sourceId, ...without.slice(insertAt)];
}

const dropClass = (target: DropTarget | null, id: string): string => {
  if (target?.id !== id) return "";
  // Inset shadow draws a Finder-style insertion line without shifting layout.
  return target.position === "before"
    ? "shadow-[inset_0_2px_0_0_var(--color-accent)]"
    : "shadow-[inset_0_-2px_0_0_var(--color-accent)]";
};

// Reordering uses plain pointer events + elementFromPoint hit-testing on the rows'
// DOM `id`s (no HTML5 drag and drop: the native shell handles file drops itself).
const rowDomId = (kind: DragInfo["kind"], id: string, parentId: string | null) =>
  `sidebar-row:${kind}:${parentId ?? ""}:${id}`;

function parseRowDomId(domId: string): DragInfo | null {
  const m = domId.match(/^sidebar-row:(table|child):([^:]*):(.+)$/);
  return m ? { kind: m[1] as DragInfo["kind"], parentId: m[2] || null, id: m[3] } : null;
}

/** Shows or hides the sidebar (View ▸ Hide Sidebar, ⌘B). It sits at the sidebar's right
 *  edge, facing the inspector button; with the sidebar hidden, the shell shows it
 *  beside the traffic lights. */
export function SidebarToggle({ className }: { className?: string }) {
  const { sidebar, setLayout } = useLayout();
  return (
    <IconButton
      aria-label={sidebar ? "Hide Sidebar" : "Show Sidebar"}
      className={className}
      onClick={() => setLayout({ sidebar: !sidebar })}
    >
      <PanelLeftIcon />
    </IconButton>
  );
}

export function ProjectSidebar() {
  const {
    nodes,
    rootOrder,
    childOrder,
    activeNodeId,
    childrenOf,
    setActiveNode,
    renameNode,
    removeNode,
    openSelector,
    reorderTables,
    reorderChildren,
  } = useProjectStore();
  const openAnalysisPicker = useOpenAnalysisPicker();
  const openGraphPicker = useOpenGraphPicker();
  const { sidebar, sidebarWidth, setLayout } = useLayout();

  const tables = rootOrder.map((id) => nodes[id]).filter(Boolean);

  // The drag's window listeners outlive renders: they read the store through this ref.
  const storeRef = React.useRef({
    rootOrder,
    childOrder,
    childrenOf,
    reorderTables,
    reorderChildren,
  });
  React.useEffect(() => {
    storeRef.current = { rootOrder, childOrder, childrenOf, reorderTables, reorderChildren };
  });

  const dragInfo = React.useRef<DragInfo | null>(null);
  const dropTargetRef = React.useRef<DropTarget | null>(null);
  const [dropTarget, setDropTarget] = React.useState<DropTarget | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  // Removes the drag's window listeners; set only while dragging.
  const cleanupRef = React.useRef<(() => void) | null>(null);

  // A drag cut short by unmounting (its row deleted) is torn down too.
  React.useEffect(() => () => cleanupRef.current?.(), []);

  const allowed = (src: DragInfo, kind: DragInfo["kind"], parentId: string | null) =>
    kind === "table" ? src.kind === "table" : src.kind === "child" && src.parentId === parentId;

  const setTarget = (next: DropTarget | null) => {
    dropTargetRef.current = next;
    setDropTarget((prev) =>
      prev?.id === next?.id && prev?.position === next?.position ? prev : next,
    );
  };

  function endDrag() {
    cleanupRef.current?.();
    dragInfo.current = null;
    setTarget(null);
    setDraggingId(null);
    document.body.style.cursor = "";
  }

  const onPointerMove = (e: PointerEvent) => {
    const src = dragInfo.current;
    if (!src) return;
    const row = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(
      "[id^='sidebar-row:']",
    );
    const target = row ? parseRowDomId(row.id) : null;
    if (!row || !target || target.id === src.id || !allowed(src, target.kind, target.parentId)) {
      setTarget(null);
      return;
    }
    const rect = row.getBoundingClientRect();
    const position: DropTarget["position"] =
      e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setTarget({ id: target.id, position });
  };

  const onPointerUp = () => {
    const src = dragInfo.current;
    const target = dropTargetRef.current;
    const { rootOrder, childOrder, childrenOf, reorderTables, reorderChildren } = storeRef.current;
    if (src && target) {
      if (src.kind === "table") {
        reorderTables(move(rootOrder, src.id, target.id, target.position));
      } else if (src.parentId) {
        const order = childOrder[src.parentId] ?? childrenOf(src.parentId).map((c) => c.id);
        reorderChildren(src.parentId, move(order, src.id, target.id, target.position));
      }
    }
    endDrag();
  };

  const rowDnd = (kind: DragInfo["kind"], id: string, parentId: string | null): RowDnd => ({
    id: rowDomId(kind, id, parentId),
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      dragInfo.current = { kind, id, parentId };
      setDraggingId(id);
      document.body.style.cursor = "grabbing";
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", endDrag);
      cleanupRef.current = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", endDrag);
        cleanupRef.current = null;
      };
    },
  });

  const rowClass = (id: string): string =>
    [dropClass(dropTarget, id), draggingId === id ? "opacity-40" : ""].filter(Boolean).join(" ");

  // Single rename dialog reused for any table or analysis row.
  const [renaming, setRenaming] = React.useState<ProjectNode | null>(null);

  // Tables whose analyses and graphs are hidden.
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());
  const setOpen = (id: string, open: boolean) => {
    const next = new Set(collapsed);
    if (open) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  // The keyboard, as in the Finder: ↑↓ move, ←→ fold and unfold (← from an analysis
  // or graph goes to its table), Return renames. ⌘⌫ deletes, from the Table menu.
  // The sidebar keeps the keyboard once used, as in the Finder: a table's grid, which
  // takes it when it shows, gets it back from a click in the table.
  const listRef = React.useRef<HTMLDivElement>(null);
  const select = (id: string) => {
    setActiveNode(id);
    setTimeout(() => listRef.current?.focus()); // after the view shows
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const node = activeNodeId ? nodes[activeNodeId] : undefined;
    if (!node || e.metaKey || e.altKey || e.ctrlKey) return;
    const rows = tables.flatMap((t) => [t.id, ...(collapsed.has(t.id) ? [] : childrenOf(t.id).map((c) => c.id))]);
    const i = rows.indexOf(node.id);
    if (e.key === "ArrowDown") select(rows[Math.min(rows.length - 1, i + 1)]);
    else if (e.key === "ArrowUp") select(rows[Math.max(0, i - 1)]);
    else if (e.key === "ArrowLeft") node.parentId ? select(node.parentId) : setOpen(node.id, false);
    else if (e.key === "ArrowRight") setOpen(node.id, true);
    else if (e.key === "Enter") setRenaming(node);
    else return;
    e.preventDefault();
  };

  const tableMenu = (table: ProjectNode) =>
    popupMenu([
      { text: "New Analysis", action: () => openAnalysisPicker(table.id) },
      { text: "New Graph", action: () => openGraphPicker(table.id) },
      { item: "Separator" },
      { text: "Rename", action: () => setRenaming(table) },
      { text: "Delete Table…", action: () => removeWithConfirm(table, removeNode) },
    ]);

  const childMenu = (child: ProjectNode) =>
    popupMenu([
      { text: "Rename", action: () => setRenaming(child) },
      { text: `Delete ${child.type === "analysis" ? "Analysis" : "Graph"}…`, action: () => removeWithConfirm(child, removeNode) },
    ]);

  return (
    <SidePanel
      side="left"
      open={sidebar}
      width={sidebarWidth}
      minWidth={SIDEBAR_WIDTH.min}
      onResize={(width, open) => setLayout({ sidebar: open, sidebarWidth: clampWidth(width, SIDEBAR_WIDTH) })}
      header={<SidebarToggle />}
      footer={
        <Button
          variant="ghost"
          className="text-secondary"
          onClick={() => openSelector({ kind: "new-table" })}
        >
          <CirclePlusIcon className="size-4" />
          New Table
        </Button>
      }
    >
      <div
        ref={listRef}
        role="tree"
        aria-label="Project"
        tabIndex={0}
        className="group px-2 pb-2 outline-none"
        onKeyDown={onKeyDown}
      >
        {tables.map((table) => (
          <SidebarItem
            key={table.id}
            icon={<TableIcon className="size-4" />}
            title={table.name}
            selected={activeNodeId === table.id}
            open={!collapsed.has(table.id)}
            onToggle={() => setOpen(table.id, collapsed.has(table.id))}
            onClick={() => select(table.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              tableMenu(table);
            }}
            className={rowClass(table.id)}
            {...rowDnd("table", table.id, null)}
          >
            {childrenOf(table.id).map((child) => (
              <SidebarItem
                key={child.id}
                icon={child.type === "analysis" ? <SigmaIcon className="size-4" /> : <LineChartIcon className="size-4" />}
                title={child.name}
                selected={activeNodeId === child.id}
                onClick={() => select(child.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  childMenu(child);
                }}
                className={rowClass(child.id)}
                {...rowDnd("child", child.id, table.id)}
              />
            ))}
          </SidebarItem>
        ))}
      </div>

      <PromptDialog
        open={renaming !== null}
        title="Rename"
        initialValue={renaming?.name ?? ""}
        onConfirm={(name) => renaming && renameNode(renaming.id, name)}
        onClose={() => setRenaming(null)}
      />
    </SidePanel>
  );
}
