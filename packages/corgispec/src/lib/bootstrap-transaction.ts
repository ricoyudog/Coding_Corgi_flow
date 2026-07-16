import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

interface Snapshot {
  path: string;
  existed: boolean;
  backupPath: string;
}

export interface BackupEntry {
  source: string;
  relativePath: string;
}

/**
 * Small filesystem transaction used by bootstrap after its complete preflight.
 * It snapshots only paths bootstrap owns and can restore both overwritten and
 * newly-created paths when a later write fails.
 */
export class BootstrapFileTransaction {
  private readonly root: string;
  private readonly snapshots: Snapshot[] = [];
  private captured = false;

  constructor(label = "bootstrap") {
    this.root = mkdtempSync(resolve(tmpdir(), `corgispec-${label}-`));
  }

  capture(paths: string[]): void {
    if (this.captured) {
      throw new Error("Bootstrap transaction paths were already captured");
    }
    this.captured = true;

    for (const [index, path] of Array.from(new Set(paths.map((entry) => resolve(entry)))).entries()) {
      const backupPath = resolve(this.root, String(index));
      const existed = existsSync(path);
      if (existed) {
        cpSync(path, backupPath, { recursive: true });
      }
      this.snapshots.push({ path, existed, backupPath });
    }
  }

  rollback(): void {
    for (const snapshot of this.snapshots.slice().reverse()) {
      rmSync(snapshot.path, { recursive: true, force: true });
      if (snapshot.existed) {
        mkdirSync(dirname(snapshot.path), { recursive: true });
        cpSync(snapshot.backupPath, snapshot.path, { recursive: true });
      }
    }
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

/** Copy files/directories into a persistent, user-visible migration backup. */
export function createPersistentBackup(
  backupRoot: string,
  entries: BackupEntry[],
): string[] {
  const written: string[] = [];
  for (const entry of entries) {
    if (!existsSync(entry.source)) continue;
    const destination = resolve(backupRoot, entry.relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(entry.source, destination, { recursive: true });
    written.push(destination);
  }
  return written;
}
