import { copyFileSync } from "node:fs";
import { inject } from "vitest";

/**
 * Puts a fresh copy of the fully migrated database at `url` (a `file:` URL). The copy is the
 * test file's own, so tests in different files never see each other's rows.
 */
export function copyMigratedDatabase(url: string) {
  copyFileSync(inject("migratedDbTemplate"), url.replace(/^file:/, ""));
}

declare module "vitest" {
  export interface ProvidedContext {
    migratedDbTemplate: string;
  }
}
