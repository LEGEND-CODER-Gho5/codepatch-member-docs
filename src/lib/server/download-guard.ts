import "server-only";
import { redirect } from "next/navigation";
import type { Actor } from "./audit";
import { getAdminActor, getViewer } from "./auth";

/**
 * For administrator-only file downloads (Admin → Backups). Returns the
 * administrator, or a response to send instead:
 * - a request started by another website (Sec-Fetch-Site: cross-site or
 *   same-site) is refused, so no other page can make the administrator's
 *   browser fetch a download (or add entries to Edit History);
 * - without an administrator session, the browser goes to the sign-in page.
 */
export async function requireAdminDownload(request: Request): Promise<{ actor: Actor } | { response: Response }> {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return { response: new Response("Downloads must be started from the Backups page.", { status: 403, headers: { "Cache-Control": "no-store" } }) };
  }
  const actor = await getAdminActor();
  if (!actor) {
    const viewer = await getViewer();
    redirect(viewer.siteAccess ? "/admin/login" : "/login");
  }
  return { actor };
}

/** Headers for a file the browser should save, never cache. */
export function downloadHeaders(filename: string, contentType: string, size?: number): HeadersInit {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
    "Cache-Control": "no-store",
    ...(size === undefined ? {} : { "Content-Length": String(size) }),
  };
}
