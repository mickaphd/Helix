import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProjectProvider } from "./store/use-project-store";
import { LayoutProvider } from "./store/use-layout";
import { AppShell } from "./components/layout/app-shell";
import { startR } from "./stats/webr";
import { checkForUpdatesDaily } from "./updates";
import "./styles.css";

// The page follows the window's appearance (system, or View ▸ Appearance).
const dark = matchMedia("(prefers-color-scheme: dark)");
const syncDark = () => document.documentElement.classList.toggle("dark", dark.matches);
dark.addEventListener("change", syncDark);
syncDark();

// Boot R in the background so it's ready by the first analysis. A failure
// surfaces later, as that analysis's error message.
startR().catch(() => {});

// Whether a newer Helix is out, at most once a day.
checkForUpdatesDaily();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ProjectProvider>
      <LayoutProvider>
        <AppShell />
      </LayoutProvider>
    </ProjectProvider>
  </StrictMode>,
);
