// The window's layout: the sidebar and the inspector (the panel on the right of a
// graph or a grouped table), each shown or not, and its width. It belongs to this Mac,
// not to the project: kept in local storage, never in the .hlx file.
import * as React from "react";
import { clamp, type Limits } from "./types";

type Width = Limits & { initial: number };
export const SIDEBAR_WIDTH: Width = { min: 180, max: 400, initial: 224 };
export const INSPECTOR_WIDTH: Width = { min: 220, max: 480, initial: 256 };
// The least room left between the panels for the table, analysis or graph.
const MIN_CONTENT = 360;

interface Layout {
  sidebar: boolean;
  sidebarWidth: number;
  inspector: boolean;
  inspectorWidth: number;
}

const KEY = "helix.layout";
const INITIAL: Layout = {
  sidebar: true,
  sidebarWidth: SIDEBAR_WIDTH.initial,
  inspector: true,
  inspectorWidth: INSPECTOR_WIDTH.initial,
};

export const clampWidth = (width: number, limits: Limits) => Math.round(clamp(width, limits));

function load(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      sidebar: typeof saved.sidebar === "boolean" ? saved.sidebar : INITIAL.sidebar,
      sidebarWidth:
        typeof saved.sidebarWidth === "number" ? clampWidth(saved.sidebarWidth, SIDEBAR_WIDTH) : INITIAL.sidebarWidth,
      inspector: typeof saved.inspector === "boolean" ? saved.inspector : INITIAL.inspector,
      inspectorWidth:
        typeof saved.inspectorWidth === "number"
          ? clampWidth(saved.inspectorWidth, INSPECTOR_WIDTH)
          : INITIAL.inspectorWidth,
    };
  } catch {
    return INITIAL;
  }
}

/** The layout, with the panels' widths as shown (see `fitWidths`). */
type LayoutValue = Layout & {
  setLayout: (patch: Partial<Layout>) => void;
  /** Whether the view shown has an inspector (a graph, a grouped table), as it says
   *  while it does (`WithInspector`). */
  inspectorHere: boolean;
  setInspectorHere: (here: boolean) => void;
};

const LayoutContext = React.createContext<LayoutValue | null>(null);

/** The panels' widths as shown: in a narrow window they give room back to the content,
 *  the inspector first, down to their minimum. Their chosen widths come back as it widens.
 *  `here`: whether the view shown has an inspector (a graph, a grouped table). */
export function fitWidths(
  { sidebar, sidebarWidth, inspector, inspectorWidth }: Layout,
  windowWidth: number,
  here: boolean,
) {
  inspector &&= here;
  let over = (sidebar ? sidebarWidth : 0) + (inspector ? inspectorWidth : 0) + MIN_CONTENT - windowWidth;
  const shrink = (width: number, { min }: Limits) => {
    const cut = Math.max(0, Math.min(over, width - min));
    over -= cut;
    return width - cut;
  };
  const inspectorShown = inspector ? shrink(inspectorWidth, INSPECTOR_WIDTH) : inspectorWidth;
  const sidebarShown = sidebar ? shrink(sidebarWidth, SIDEBAR_WIDTH) : sidebarWidth;
  return { sidebarWidth: sidebarShown, inspectorWidth: inspectorShown };
}

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [layout, setState] = React.useState(load);
  const [windowWidth, setWindowWidth] = React.useState(window.innerWidth);
  const [inspectorHere, setInspectorHere] = React.useState(false);
  React.useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  React.useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(layout));
    } catch {
      // Not saved: the next launch starts from the defaults.
    }
  }, [layout]);
  const setLayout = React.useCallback((patch: Partial<Layout>) => setState((l) => ({ ...l, ...patch })), []);
  // Resizing the window changes the layout only when the panels have to give room back:
  // otherwise the value stays the same object, and nothing redraws.
  const { sidebarWidth, inspectorWidth } = fitWidths(layout, windowWidth, inspectorHere);
  const value = React.useMemo(
    () => ({ ...layout, sidebarWidth, inspectorWidth, setLayout, inspectorHere, setInspectorHere }),
    [layout, sidebarWidth, inspectorWidth, setLayout, inspectorHere],
  );
  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayout(): LayoutValue {
  const value = React.useContext(LayoutContext);
  if (!value) throw new Error("useLayout must be used inside <LayoutProvider>");
  return value;
}
