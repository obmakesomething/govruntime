import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface FileLockOptions {
  timeoutMs?: number;
  retryDelayMs?: number;
}

interface LockOwner {
  version: "gr.lock.v1";
  token: string;
  pid: number;
  hostname: string;
  created_at: string;
}

interface HeldLock {
  depth: number;
  token: string;
}

const heldLocks = new Map<string, HeldLock>();
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
const PARTIAL_LOCK_GRACE_MS = 250;

export function withFileLock<T>(
  filePath: string,
  action: () => T,
  options: FileLockOptions = {},
): T {
  const resolvedPath = path.resolve(filePath);
  const held = heldLocks.get(resolvedPath);
  if (held) {
    held.depth += 1;
    try {
      return action();
    } finally {
      held.depth -= 1;
    }
  }

  const token = acquire(resolvedPath, options);
  heldLocks.set(resolvedPath, { depth: 1, token });
  try {
    return action();
  } finally {
    heldLocks.delete(resolvedPath);
    release(resolvedPath, token);
  }
}

function acquire(filePath: string, options: FileLockOptions): string {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const retryDelayMs = options.retryDelayMs ?? 10;
  const deadline = Date.now() + timeoutMs;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  while (true) {
    const token = crypto.randomUUID();
    const owner: LockOwner = {
      version: "gr.lock.v1",
      token,
      pid: process.pid,
      hostname: os.hostname(),
      created_at: new Date().toISOString(),
    };

    let fd: number | undefined;
    try {
      fd = fs.openSync(filePath, "wx", 0o600);
      fs.writeFileSync(fd, JSON.stringify(owner) + "\n", "utf8");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      return token;
    } catch (error) {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          // Preserve the original acquisition error.
        }
        try {
          fs.unlinkSync(filePath);
        } catch {
          // Another process may already have removed the incomplete lock.
        }
      }

      if (!isAlreadyExists(error)) throw error;
      assertContendedLockCanWait(filePath);
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for governance lock: ${filePath}`);
      }
      Atomics.wait(sleepBuffer, 0, 0, retryDelayMs);
    }
  }
}

function release(filePath: string, token: string): void {
  const owner = readOwner(filePath);
  if (!owner || owner.token !== token || owner.pid !== process.pid || owner.hostname !== os.hostname()) {
    throw new Error(`Governance lock ownership was lost: ${filePath}`);
  }
  fs.unlinkSync(filePath);
}

function assertContendedLockCanWait(filePath: string): void {
  const owner = readOwner(filePath);
  if (owner) {
    if (owner.hostname === os.hostname() && !isProcessAlive(owner.pid)) {
      throw new Error(
        `Stale governance lock requires verified recovery: ${filePath} `
        + `(owner pid ${owner.pid} on ${owner.hostname})`,
      );
    }
    return;
  }

  try {
    const ageMs = Date.now() - fs.statSync(filePath).mtimeMs;
    if (ageMs >= PARTIAL_LOCK_GRACE_MS) {
      throw new Error(`Malformed governance lock requires verified recovery: ${filePath}`);
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

function readOwner(filePath: string): LockOwner | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<LockOwner>;
    if (
      parsed.version !== "gr.lock.v1"
      || typeof parsed.token !== "string"
      || !Number.isInteger(parsed.pid)
      || typeof parsed.hostname !== "string"
      || typeof parsed.created_at !== "string"
    ) {
      return null;
    }
    return parsed as LockOwner;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNoSuchProcess(error);
  }
}

function isAlreadyExists(error: unknown): boolean {
  return isNodeError(error) && error.code === "EEXIST";
}

function isNoSuchProcess(error: unknown): boolean {
  return isNodeError(error) && error.code === "ESRCH";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
