/** Browser-only helpers for the document export buttons. */

/** Copies formatted HTML (with a plain-text alternative) so it pastes with formatting into Google Docs. */
export async function copyRichText(html: string, text: string): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    return;
  }
  // Older browsers: select a hidden, rendered copy and use the legacy copy command.
  // The HTML is built from escaped values only (document-html.ts).
  const holder = document.createElement("div");
  holder.setAttribute("contenteditable", "true");
  holder.style.cssText = "position:fixed;left:-10000px;top:0;opacity:0;";
  holder.innerHTML = html;
  document.body.appendChild(holder);
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(holder);
  selection?.removeAllRanges();
  selection?.addRange(range);
  const copied = document.execCommand("copy");
  selection?.removeAllRanges();
  holder.remove();
  if (!copied) throw new Error("Copying is blocked in this browser.");
}

/** Saves bytes as a file download. */
export function downloadFile(bytes: Uint8Array, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A blank Google Doc in the signed-in Google account. */
export const NEW_GOOGLE_DOC_URL = "https://docs.new";
