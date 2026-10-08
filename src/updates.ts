// Whether a newer Helix is out: the latest release (`latestVersion`) against this version.
// Checked quietly at launch (at most once a day) and from Helix ▸ Check for Updates…. The
// user downloads and installs a new version themselves.
import { alert, appVersion, askToDownload, isNative, openLink } from "./native";
import { isNewer, latestVersion } from "./lib/version";

const CHECKED_KEY = "helix.updatesCheckedAt";
const DAY = 24 * 60 * 60 * 1000;

/** `quiet`: say something only when a newer version is out (the launch check). */
export async function checkForUpdates(quiet = false) {
  if (!isNative) return;
  try {
    const latest = await latestVersion();
    const current = await appVersion();
    if (typeof latest === "string" && isNewer(latest, current)) {
      if (await askToDownload(latest.replace(/^v/i, ""))) openLink("releases");
    } else if (!quiet) {
      await alert("Helix is up to date", `Version ${current} is the latest.`, "info");
    }
  } catch {
    if (!quiet) await alert("Couldn't Check for Updates", "Check your internet connection and try again.");
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
