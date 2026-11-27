import type { Metadata } from "next";
import { DepartmentsManager } from "@/components/admin/catalog-manager";
import { PageHeader } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/server/auth";
import { listDepartments } from "@/lib/server/queries";

export const metadata: Metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  await requireAdminPage();
  const departments = await listDepartments();
  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Department Management"
        description="Departments organize the member directory into columns. Changes appear in the directory immediately."
      />
      <DepartmentsManager
        departments={departments.map((department) => ({
          id: department.id,
          name: department.name,
          description: department.description,
          sortOrder: department.sortOrder,
          activeMembers: department.activeMembers,
          totalMembers: department.totalMembers,
          hoursTotal: department.hoursTotal,
        }))}
      />
    </>
  );
}
