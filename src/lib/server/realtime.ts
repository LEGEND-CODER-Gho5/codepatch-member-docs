import "server-only";
import { EventEmitter } from "node:events";
import type { Queryable } from "./db";

export type RealtimeScope = "directory" | "member" | "admin";

const store = globalThis as unknown as { __cpsRealtimeBus?: EventEmitter };

/** In-process wake-up signal so open streams on this instance react instantly. */
export const realtimeBus: EventEmitter =
  store.__cpsRealtimeBus ??
  (() => {
    const bus = new EventEmitter();
    bus.setMaxListeners(0);
    store.__cpsRealtimeBus = bus;
    return bus;
  })();

export function pokeRealtime() {
  realtimeBus.emit("poke");
}

/**
 * Records a change event in the database (inside the caller's transaction) so
 * every server instance's open event streams can deliver it.
 */
export async function emitRealtime(tx: Queryable, scopes: Iterable<RealtimeScope>, memberId: string | null = null) {
  const unique = [...new Set(scopes)];
  if (unique.length === 0) return;
  const params: unknown[] = [];
  const values = unique.map((scope) => {
    params.push(scope, memberId);
    return `($${params.length - 1}, $${params.length}::uuid)`;
  });
  await tx.query(`INSERT INTO realtime_events (scope, member_id) VALUES ${values.join(", ")}`, params);
}
