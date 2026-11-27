import { redirect } from "next/navigation";
import { getViewer } from "@/lib/server/auth";

export default async function Home() {
  const viewer = await getViewer();
  redirect(viewer.siteAccess ? "/directory" : "/login");
}
