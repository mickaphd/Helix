import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProjectProvider } from "./store/use-project-store";
import { LayoutProvider } from "./store/use-layout";
import { AppShell } from "./components/layout/app-shell";
import { connectR } from "./stats/webr";
import { accentColor, evalR, isNative, onFocusChange } from "./native";
import { checkForUpdatesDaily } from "./updates";
import "./styles.css";

// The page follows the window's appearance (system, or View ▸ Appearance).
const dark = matchMedia("(prefers-color-scheme: dark)");
const syncDark = () => document.documentElement.classList.toggle("dark", dark.matches);
dark.addEventListener("change", syncDark);
syncDark();

// Highlights take the accent color chosen in System Settings, read again whenever
// the window comes to the front (it can only change while System Settings is).
const syncAccent = () =>
  void accentColor().then((color) => color && document.documentElement.style.setProperty("--accent", color));
onFocusChange((focused) => focused && syncAccent());

// Analyses run in the app's one R, in the engine window (engine.ts). In a plain
// browser (`npm run web`), this page starts its own R at the first analysis.
if (isNative) connectR(evalR);

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
