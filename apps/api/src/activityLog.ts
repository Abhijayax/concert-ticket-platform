export interface ActivityEntry {
  at: string;
  type: string;
  actor: string;
  detail?: string;
}

const MAX_ENTRIES = 500;
const entries: ActivityEntry[] = [];

/**
 * In-memory activity log for the admin view. It holds the most recent entries for this
 * process only and is lost on restart. It is not a durable audit trail.
 */
export function logActivity(type: string, actor: string, detail?: string): void {
  entries.push({
    at: new Date().toISOString(),
    type,
    actor,
    ...(detail === undefined ? {} : { detail }),
  });

  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

export function listActivity(): ActivityEntry[] {
  return [...entries].reverse();
}
