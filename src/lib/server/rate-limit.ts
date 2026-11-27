import "server-only";
import { sql, sqlOne } from "./db";

export type LoginScope = "site" | "member" | "admin";

const WINDOW_MINUTES = 15;
/** Failed attempts from one browser/IP against one account before a temporary lock. */
export const KEY_LIMIT = 5;
/** Failed attempts against one account from all sources. */
const TARGET_LIMIT = 20;
/** Failed attempts from one IP across all accounts. */
const IP_LIMIT = 40;

type Counts = {
  key_failures: number;
  target_failures: number;
  ip_failures: number;
  oldest_key: Date | null;
};

async function loadCounts(scope: LoginScope, target: string, ip: string): Promise<Counts> {
  const row = await sqlOne<Counts>(
    `WITH last_success AS (
        SELECT coalesce(max(attempted_at), '-infinity'::timestamptz) AS at
          FROM login_attempts
         WHERE scope = $1 AND target = $2 AND ip_address = $3 AND succeeded
     ), recent AS (
        SELECT scope, target, ip_address, attempted_at
          FROM login_attempts
         WHERE NOT succeeded AND attempted_at > now() - interval '${WINDOW_MINUTES} minutes'
     )
     SELECT
       (SELECT count(*) FROM recent WHERE scope = $1 AND target = $2 AND ip_address = $3
           AND attempted_at > (SELECT at FROM last_success)) AS key_failures,
       (SELECT count(*) FROM recent WHERE scope = $1 AND target = $2) AS target_failures,
       (SELECT count(*) FROM recent WHERE ip_address = $3) AS ip_failures,
       (SELECT min(attempted_at) FROM recent WHERE scope = $1 AND target = $2 AND ip_address = $3
           AND attempted_at > (SELECT at FROM last_success)) AS oldest_key`,
    [scope, target, ip],
  );
  return row ?? { key_failures: 0, target_failures: 0, ip_failures: 0, oldest_key: null };
}

export async function checkLoginThrottle(
  scope: LoginScope,
  target: string,
  ip: string,
): Promise<{ allowed: true } | { allowed: false; retryAfterMinutes: number }> {
  const counts = await loadCounts(scope, target, ip);
  if (counts.key_failures >= KEY_LIMIT) {
    const oldest = counts.oldest_key ? new Date(counts.oldest_key).getTime() : Date.now();
    const retry = Math.max(1, Math.ceil((oldest + WINDOW_MINUTES * 60_000 - Date.now()) / 60_000));
    return { allowed: false, retryAfterMinutes: retry };
  }
  if (counts.target_failures >= TARGET_LIMIT || counts.ip_failures >= IP_LIMIT) {
    return { allowed: false, retryAfterMinutes: WINDOW_MINUTES };
  }
  return { allowed: true };
}

/** Records an attempt. Returns lockedNow=true on the failure that triggers a lock. */
export async function recordLoginAttempt(
  scope: LoginScope,
  target: string,
  ip: string,
  succeeded: boolean,
): Promise<{ lockedNow: boolean }> {
  await sql("INSERT INTO login_attempts (scope, target, ip_address, succeeded) VALUES ($1, $2, $3, $4)", [
    scope,
    target,
    ip,
    succeeded,
  ]);
  if (succeeded) return { lockedNow: false };
  const counts = await loadCounts(scope, target, ip);
  return { lockedNow: counts.key_failures === KEY_LIMIT };
}

export function failureDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 300 + Math.floor(Math.random() * 300)));
}
