// Whether a newer Helix is out, and installing it: checked quietly at launch (at most
// once a day) and from Helix ▸ Check for Updates…. The shell does the work (`check_update`,
// `install_update`): Helix asks, then relaunches with the new version.
import { alert, appVersion, askToInstall, checkUpdate, installUpdate, isNative, openLink } from "./native";

const CHECKED_KEY = "helix.updatesCheckedAt";
const DAY = 24 * 60 * 60 * 1000;

/** `quiet`: say something only when a newer version is out (the launch check). */
export async function checkForUpdates(quiet = false) {
  if (!isNative) return;
  let latest: string | null;
  const current = await appVersion();
  try {
    latest = await checkUpdate();
  } catch (failure) {
    if (!quiet)
      await alert(
        "Couldn't Check for Updates",
        failure === "offline"
          ? "Check your internet connection and try again."
          : "The latest version's details aren't available yet. Try again later.",
      );
    return;
  }
  if (!latest) {
    if (!quiet) await alert("Helix is up to date", `Version ${current} is the latest.`, "info");
    return;
  }
  const answer = await askToInstall(latest, current);
  if (answer === "notes") openLink("releases");
  if (answer !== "install") return;
  try {
    await installUpdate();
  } catch {
    await alert("Couldn't Install the Update", "Check your internet connection and try again.");
  }
}

/** The launch check, at most once a day. */
export function checkForUpdatesDaily() {
  try {
    if (Date.now() - Number(localStorage.getItem(CHECKED_KEY)) < DAY) return;
    localStorage.setItem(CHECKED_KEY, String(Date.now()));
  } catch {
    // no storage: check anyway
  }
  void checkForUpdates(true);
}
