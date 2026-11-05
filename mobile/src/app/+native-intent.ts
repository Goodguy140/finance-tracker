import { systemPathTarget } from '@/utils/system-path';

/** A link that opens the app: see `systemPathTarget`. An empty answer leaves the app where it is. */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  return systemPathTarget(path, initial);
}
