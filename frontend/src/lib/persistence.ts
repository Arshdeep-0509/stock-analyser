/**
 * Generic versioned localStorage persistence. Every feature that persists
 * state (parameters, watchlists, alert rules) goes through this so the
 * "migration guard" behaviour is consistent everywhere: a payload whose
 * version doesn't match is handed to `migrate` rather than trusted as-is,
 * and any failure (quota, corrupt JSON, private-mode storage) degrades to
 * "nothing persisted" instead of throwing.
 */

interface VersionedPayload<T> {
  version: number
  data: T
}

export function saveVersioned<T>(key: string, version: number, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ version, data } satisfies VersionedPayload<T>))
  } catch {
    // Not worth surfacing — a failed save just means this session's edits don't persist.
  }
}

/**
 * `migrate` receives whatever payload shape was actually found (a stale
 * version, or malformed data) and must return either an upgraded T or null
 * to discard it. Passing `(payload) => null` for every non-current version
 * is a valid (if blunt) migration guard: it never crashes on old data, it
 * just resets to defaults.
 */
export function loadVersioned<T>(
  key: string,
  currentVersion: number,
  migrate: (payload: VersionedPayload<unknown>) => T | null,
): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as VersionedPayload<unknown>
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.version !== 'number') return null
    if (parsed.version === currentVersion) return parsed.data as T
    return migrate(parsed)
  } catch {
    return null
  }
}

export function removeVersioned(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Same rationale as saveVersioned.
  }
}
