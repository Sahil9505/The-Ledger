import fs from "fs";
import path from "path";

// Vercel (and other serverless) platforms expose a read-only filesystem
// except for /tmp. Persist the on-disk cache there so it survives across
// invocations on the same instance instead of throwing on write. Locally we
// keep the repo-relative .cache dir.
const CACHE_DIR = process.env.VERCEL ? "/tmp/.cache" : path.join(process.cwd(), ".cache");

function ensureDir(): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function filePath(filename: string): string {
  return path.join(CACHE_DIR, filename);
}

export function loadDiskCache<T>(
  filename: string,
): Map<string, { data: T; expiresAt: number }> | null {
  try {
    const fp = filePath(filename);
    if (!fs.existsSync(fp)) return null;
    const raw = fs.readFileSync(fp, "utf-8");
    const obj = JSON.parse(raw) as Record<string, { data: T; expiresAt: number }>;
    const map = new Map<string, { data: T; expiresAt: number }>();
    const now = Date.now();
    for (const [key, entry] of Object.entries(obj)) {
      if (entry.expiresAt > now) {
        map.set(key, entry);
      }
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

export function persistCache<T>(
  filename: string,
  map: Map<string, { data: T; expiresAt: number }>,
): void {
  try {
    ensureDir();
    const obj: Record<string, { data: T; expiresAt: number }> = {};
    for (const [key, entry] of map) {
      obj[key] = entry;
    }
    fs.writeFileSync(filePath(filename), JSON.stringify(obj), "utf-8");
  } catch {
    /* ignore */
  }
}
