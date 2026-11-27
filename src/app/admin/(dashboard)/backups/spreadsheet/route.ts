import { recordBackupDownload } from "@/lib/server/backup-jobs";
import { downloadHeaders, requireAdminDownload } from "@/lib/server/download-guard";
import { buildSpreadsheetExport } from "@/lib/server/spreadsheet-export";
import { todayInAppTimeZone } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Admin → Backups → Download spreadsheet: every member, record, hour, and meeting as an Excel workbook (no passwords). */
export async function GET(request: Request) {
  const guard = await requireAdminDownload(request);
  if ("response" in guard) return guard.response;

  const workbook = await buildSpreadsheetExport();
  const filename = `code-patch-stem-data-${todayInAppTimeZone()}.xlsx`;
  await recordBackupDownload(guard.actor, "Downloaded the spreadsheet export", { file: filename, size: workbook.length });
  return new Response(new Uint8Array(workbook), {
    headers: downloadHeaders(filename, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", workbook.length),
  });
}
