import "server-only";
import type { ActionResult } from "@/lib/types";

export class ActionError extends Error {
  constructor(
    message: string,
    public code: "unauthorized" | "not_found" | "invalid" | "conflict" = "invalid",
  ) {
    super(message);
  }
}

export function fail(error: string, code?: "unauthorized" | "not_found" | "invalid" | "conflict"): { ok: false; error: string; code?: typeof code } {
  return { ok: false, error, code };
}

export const UNAUTHORIZED = fail("Your session does not permit this change. Please sign in again.", "unauthorized");

/** Converts thrown errors into safe, user-facing results without leaking internals. */
export function handleActionError(error: unknown, context: string): ActionResult<never> {
  if (error instanceof ActionError) return fail(error.message, error.code);
  const code = (error as { code?: string } | null)?.code;
  if (code === "23505") return fail("That name is already in use.", "conflict");
  if (code === "23503") return fail("That record is still referenced by other data.", "conflict");
  if (code === "23514" || code === "22P02" || code === "22007" || code === "22008") {
    return fail("One of the values is not valid.", "invalid");
  }
  console.error(`[action:${context}]`, error);
  return fail("The change could not be saved. Please try again.");
}
