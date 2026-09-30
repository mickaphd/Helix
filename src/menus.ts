// The parts of the menu bar that don't depend on a project, shared by the project
// windows' menu bar (app-menu.ts) and the one the engine window sets while no
// project window is open (engine.ts).
import {
  alert,
  chooseProject,
  installMenuBar,
  newProject,
  openLink,
  openProjects,
  openSample,
  type MenuItems,
} from "./native";
import { fileName } from "./lib/paths";
import { checkForUpdates } from "./updates";
import { version } from "../package.json";

export const separator = { item: "Separator" } as const;

// The icon comes from the app bundle. The website and GitHub are in the Help menu.
const ABOUT = {
  name: "Helix", // spelled out: in development the process is named "helix"
  version,
  shortVersion: "", // empty: no "(1.0.0)" after the version
  credits: "Scientific data analysis, simplified.",
  copyright: "© 2026 mickaphd\nFree and open source (GPL-3.0). No warranty.",
};

/** Opens projects (native.openProjects); one that is gone is reported, and `forget` drops it. */
export function openProjectsOrSay(paths: string[], forget: (path: string) => void = () => {}) {
  openProjects(paths).catch((gone: unknown) => {
    void alert("Couldn't Open Project", `“${fileName(String(gone))}” couldn't be found. It may have been moved or deleted.`, "error");
    forget(String(gone));
  });
}

/** File ▸ New Project, Open…, Open Recent: how every File menu starts. `forgetRecent`
 *  drops a recent project that is gone. */
export function projectItems(recents: string[], forgetRecent: (path: string) => void, clearRecents: () => void): MenuItems {
  const recentItems = recents.length
    ? [
        ...recents.map((path) => ({
          text: fileName(path),
          action: () => openProjectsOrSay([path], forgetRecent),
        })),
        separator,
        { text: "Clear Menu", action: clearRecents },
      ]
    : [{ text: "No Recent Projects", enabled: false }];
  return [
    { text: "New Project", accelerator: "CmdOrCtrl+N", action: () => void newProject() },
    { text: "Open…", accelerator: "CmdOrCtrl+O", action: () => void chooseProject() },
    { text: "Open Recent", items: recentItems },
  ];
}

/** Sets the app's menu bar: the Helix menu, `menus`, then Window and Help. */
export function setMenuBar(menus: MenuItems) {
  const helix = {
    text: "Helix",
    items: [
      { item: { About: ABOUT }, text: "About Helix" },
      { text: "Check for Updates…", action: () => void checkForUpdates() },
      separator,
      { item: "Services" },
      separator,
      { item: "Hide", text: "Hide Helix" },
      { item: "HideOthers" },
      { item: "ShowAll" },
      separator,
      // The shell closes every project window first: each asks about its unsaved changes.
      { item: "Quit", text: "Quit Helix" },
    ],
  } as const;
  return installMenuBar(
    [helix, ...menus],
    [{ item: "Minimize" }, { item: "Maximize" }, separator, { item: "BringAllToFront" }],
    [
      { text: "Helix Website", action: () => openLink("website") },
      { text: "Helix on GitHub", action: () => openLink("github") },
      separator,
      { text: "Sample Project", action: () => void openSample() },
    ],
  );
}
