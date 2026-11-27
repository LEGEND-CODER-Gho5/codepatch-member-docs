import { getViewer, parseSessionCookies, resolveViewer, type Viewer } from "@/lib/server/auth";
import { sql, sqlOne } from "@/lib/server/db";
import { realtimeBus } from "@/lib/server/realtime";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLL_MS = 2000;
const HEARTBEAT_MS = 25_000;
const REAUTH_MS = 30_000;
// Streams are recycled periodically (the browser reconnects automatically and
// resumes from Last-Event-ID), which keeps serverless function durations bounded.
const LIFETIME_MS = 240_000;

type EventRow = { id: number; scope: "directory" | "member" | "admin"; member_id: string | null };

function canSee(viewer: Viewer, row: EventRow) {
  if (viewer.admin) return true;
  if (row.scope === "directory") return viewer.siteAccess;
  if (row.scope === "member") return viewer.member !== null && row.member_id === viewer.member.id;
  return false;
}

/**
 * Server-Sent Events stream of change notifications. Each event is filtered
 * against the requesting session: administrators receive everything, members
 * only directory changes and changes to their own records, and directory-only
 * visitors only directory changes. Payloads never include document content.
 */
export async function GET(request: Request) {
  let viewer = await getViewer();
  if (!viewer.siteAccess) {
    return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const tokens = parseSessionCookies(request.headers.get("cookie"));

  const resumeFrom = request.headers.get("last-event-id");
  let lastId = resumeFrom && /^\d{1,15}$/.test(resumeFrom) ? Number(resumeFrom) : 0;
  if (!lastId) {
    const row = await sqlOne<{ max: number | null }>("SELECT max(id) AS max FROM realtime_events");
    lastId = Number(row?.max ?? 0);
  }

  const encoder = new TextEncoder();
  let stop: () => void = () => undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let running = false;
      let again = false;

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };

      const tick = async () => {
        if (closed) return;
        if (running) {
          again = true;
          return;
        }
        running = true;
        try {
          const rows = await sql<EventRow>(
            "SELECT id, scope, member_id FROM realtime_events WHERE id > $1 ORDER BY id ASC LIMIT 200",
            [lastId],
          );
          for (const row of rows) {
            lastId = Number(row.id);
            if (canSee(viewer, row)) {
              const payload = JSON.stringify({ scope: row.scope, memberId: row.scope === "member" ? row.member_id : null });
              send(`id: ${row.id}\nevent: change\ndata: ${payload}\n\n`);
            } else {
              send(`id: ${row.id}\n\n`);
            }
          }
        } catch {
          // Transient database errors: the next poll retries.
        } finally {
          running = false;
          if (again) {
            again = false;
            void tick();
          }
        }
      };

      const reauthorize = async () => {
        try {
          const current = await resolveViewer(tokens);
          if (!current.siteAccess) {
            send("event: revoked\ndata: {}\n\n");
            close();
            return;
          }
          if (current.admin !== viewer.admin || current.member?.id !== viewer.member?.id) {
            send("event: revoked\ndata: {}\n\n");
          }
          viewer = current;
        } catch {
          /* keep the previous authorization until the next check */
        }
      };

      const onPoke = () => void tick();
      realtimeBus.on("poke", onPoke);
      const poll = setInterval(() => void tick(), POLL_MS);
      const heartbeat = setInterval(() => send(": keep-alive\n\n"), HEARTBEAT_MS);
      const reauth = setInterval(() => void reauthorize(), REAUTH_MS);
      const lifetime = setTimeout(() => close(), LIFETIME_MS);

      function close() {
        if (closed) return;
        closed = true;
        realtimeBus.off("poke", onPoke);
        clearInterval(poll);
        clearInterval(heartbeat);
        clearInterval(reauth);
        clearTimeout(lifetime);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
      stop = close;
      request.signal.addEventListener("abort", close);
      send(`retry: 3000\n: connected\n\n`);
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
