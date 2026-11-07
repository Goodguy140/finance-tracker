/**
 * Settings → About this app: which build of the app is installed and which update it is running,
 * worded from what iOS (expo-application) and expo-updates report. Plain data in, text out, so the
 * wording is tested without a phone.
 */

/** What iOS says about the installed app: the version and build number App Store Connect shows. */
export type InstalledBuild = { version: string | null; build: string | null };

/** What expo-updates says about the code running now (its `useUpdates().currentlyRunning`, plus `isEnabled`). */
export type RunningCode = {
  enabled: boolean;
  updateId?: string | null;
  createdAt?: Date | null;
  channel?: string | null;
  runtimeVersion?: string | null;
  isEmbeddedLaunch: boolean;
  isEmergencyLaunch: boolean;
};

/** "0.1.0 (build 17)", as TestFlight lists it. */
export function buildText({ version, build }: InstalledBuild): string {
  if (!version && !build) return 'Unknown';
  if (!build) return version!;
  return `${version ?? 'Unknown'} (build ${build})`;
}

/** The running update in a line, and a note when there is something to explain. */
export function updateText(running: RunningCode, locale?: string): { value: string; note: string | null } {
  if (!running.enabled) {
    return { value: 'Off', note: 'This build does not take updates: it runs the code it was built with.' };
  }
  if (running.isEmergencyLaunch) {
    return { value: 'None', note: 'The last update could not start, so the app went back to the code this build came with.' };
  }
  if (running.isEmbeddedLaunch || !running.updateId) {
    return { value: 'None', note: 'Running the code this build came with.' };
  }
  return { value: running.createdAt ? publishedText(running.createdAt, locale) : 'Installed', note: null };
}

/** "Published Nov 7, 2026, 3:02 AM": when the update was published, as `eas update:list` and expo.dev list it. */
export function publishedText(createdAt: Date, locale?: string): string {
  const day = createdAt.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = createdAt.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  // ICU puts a narrow no-break space before AM/PM; a plain one reads the same and copies cleanly.
  return `Published ${day}, ${time}`.replace(/\u202f/g, ' ');
}

/** The fingerprint is a 40-character hash; its first 7 are enough to match one in `eas update:list`. */
export function shortRuntime(runtimeVersion: string | null | undefined): string | null {
  if (!runtimeVersion) return null;
  return /^[0-9a-f]{40}$/i.test(runtimeVersion) ? runtimeVersion.slice(0, 7) : runtimeVersion;
}

/** The one line to show when a newer update is downloaded and waits for the app to open again. */
export const PENDING_NOTE = 'A newer update is downloaded. It starts the next time the app opens, or restart now.';
