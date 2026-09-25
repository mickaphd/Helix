// Whether a newer Helix is out: GitHub's latest release against this version. Checked
// quietly at launch (at most once a day) and from Helix ▸ Check for Updates…. The
// user downloads and installs a new version themselves.
import { alert, appVersion, askToDownload, isNative, openLink } from "./native";
import { isNewer } from "./lib/version";

const LATEST = "https://api.github.com/repos/mickaphd/Helix/releases/latest";
const CHECKED_KEY = "helix.updatesCheckedAt";
const DAY = 24 * 60 * 60 * 1000;

/** `quiet`: say something only when a newer version is out (the launch check). */
export async function checkForUpdates(quiet = false) {
  if (!isNative) return;
  try {
    const response = await fetch(LATEST, { headers: { Accept: "application/vnd.github+json" } });
    // 404: nothing released yet.
    const latest = response.status === 404 ? null : response.ok ? (await response.json()).tag_name : undefined;
    if (latest === undefined) throw new Error(`GitHub answered ${response.status}`);
    const current = await appVersion();
    if (typeof latest === "string" && isNewer(latest, current)) {
      if (await askToDownload(latest.replace(/^v/i, ""))) openLink("releases");
    } else if (!quiet) {
      await alert("Helix is up to date", `Version ${current} is the latest.`, "info");
    }
  } catch {
    if (!quiet) await alert("Couldn't check for updates", "Check your internet connection and try again.");
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
