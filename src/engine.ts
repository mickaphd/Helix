// The hidden "engine" window, open as long as Helix is: the app's one R, which
// every project window uses, and the menu bar while no project window is open.
import { evalNamedVector, startR } from "./stats/webr";
import { onNoWindows, serveR } from "./native";
import { projectItems, setMenuBar } from "./menus";
import { loadRecents, saveRecents } from "./store/recents";

startR().catch(() => {}); // a failed boot is retried by the first request, which reports it
void serveR(evalNamedVector);

/** With no project open, Helix stays open (as Pages does) with a menu bar to open one. */
function setWindowlessMenuBar() {
  const keepRecents = (paths: string[]) => {
    saveRecents(paths);
    setWindowlessMenuBar();
  };
  const recents = loadRecents();
  const forgetRecent = (path: string) => keepRecents(recents.filter((p) => p !== path));
  void setMenuBar([{ text: "File", items: projectItems(recents, forgetRecent, () => keepRecents([])) }]);
}
onNoWindows(setWindowlessMenuBar);
