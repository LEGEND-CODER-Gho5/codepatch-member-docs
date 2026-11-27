/**
 * The welcome page's portal guide and the chapter's policies and procedures.
 * The administrator can replace the policies in Settings; an empty value means
 * DEFAULT_SITE_RULES. Format: "# " starts a heading, "- " a bullet, and any
 * other line is a paragraph. The text is only ever rendered as text.
 */
export const SITE_RULES_MAX_LENGTH = 10_000;

export const DEFAULT_SITE_RULES = `# Honest records
- Record only contributions and volunteer hours you actually completed, with the correct dates and hours.
- Your hours count once a supervisor has verified them on your Volunteer Hours Record.
- Records that are false or exaggerated may be removed, and chapter officers may take further action.

# Passwords and privacy
- Keep the chapter password within the chapter. Do not post or share it publicly.
- Never share your personal password or use another member's. If you think someone knows yours, ask the chapter administrator for a new one.
- Open only your own records. The chapter administrator can view and edit every record, and every change is saved in the edit history.
- Do not put other people's private information, such as phone numbers, addresses, or grades, in your records.

# Using the portal
- Keep your records up to date and complete them by the deadlines chapter officers announce.
- Write clearly and respectfully. Supervisors and chapter officers may read your records.
- Sign out when you finish, especially on a shared or school computer.

# Questions
- Contact the chapter administrator if you need your password, notice a mistake, or have a question about these rules.`;

/** Steps shown above the policies; they describe how the portal actually works. */
export const PORTAL_GUIDE: { title: string; body: string }[] = [
  { title: "Find your name", body: "The member directory lists everyone by department. Select your name." },
  { title: "Enter your personal password", body: "Each member has their own password. Ask the chapter administrator if you don't have yours." },
  { title: "Document your contributions", body: "In Member Documentation, add a dated entry for each contribution you made." },
  { title: "Log your volunteer hours", body: "In the Volunteer Hours Record, add a row for each activity. The total adds up automatically." },
  { title: "Save and share", body: "Changes save as you type. Use Print, Download PDF, or Copy to Google Docs when you need a copy." },
];

export type RulesBlock = { type: "heading"; text: string } | { type: "list"; items: string[] } | { type: "paragraph"; text: string };

export function parseRules(text: string): RulesBlock[] {
  const blocks: RulesBlock[] = [];
  for (const raw of (text || "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("# ")) {
      blocks.push({ type: "heading", text: line.slice(2).trim() });
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      const last = blocks[blocks.length - 1];
      const item = line.slice(2).trim();
      if (last?.type === "list") last.items.push(item);
      else blocks.push({ type: "list", items: [item] });
    } else {
      blocks.push({ type: "paragraph", text: line });
    }
  }
  return blocks;
}

/** The policies currently in force: the administrator's text, or the default. */
export function effectiveRules(saved: string | null | undefined): string {
  return saved && saved.trim() ? saved : DEFAULT_SITE_RULES;
}
