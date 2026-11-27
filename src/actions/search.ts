"use server";

import { getAdminActor } from "@/lib/server/auth";
import { listMembers } from "@/lib/server/queries";
import type { ActionResult } from "@/lib/types";
import { UNAUTHORIZED } from "./shared";

export type SearchMember = {
  id: string;
  fullName: string;
  memberCode: string;
  departmentName: string;
  email: string | null;
  status: "active" | "inactive";
};

/** Administrator only: the members the quick search (Ctrl+K) can jump to. */
export async function listSearchMembersAction(): Promise<ActionResult<SearchMember[]>> {
  if (!(await getAdminActor())) return UNAUTHORIZED;
  const members = await listMembers();
  return {
    ok: true,
    data: members.map((member) => ({
      id: member.id,
      fullName: member.fullName,
      memberCode: member.memberCode,
      departmentName: member.departmentName,
      email: member.email,
      status: member.status,
    })),
  };
}
