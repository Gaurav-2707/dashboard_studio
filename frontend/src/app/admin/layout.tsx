/**
 * Dashify — Admin Layout
 * Additional guard wrapper (defense-in-depth alongside middleware)
 */

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AdminLayoutClient from "./admin-layout-client";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, company_id")
    .eq("id", user.id)
    .single();

  console.log("[ADMIN LAYOUT PROFILE]:", JSON.stringify(profile), "USER ID:", user.id, "ERROR:", error);

  if (!profile || profile.role !== "admin") {
    redirect(`/dashboard/${profile?.company_id || ""}`);
  }

  let companyName = "System Workspace";
  if (profile.company_id) {
    const { data: company } = await supabase
      .from("companies")
      .select("name")
      .eq("id", profile.company_id)
      .single();
    if (company) {
      companyName = company.name;
    }
  }

  return (
    <AdminLayoutClient
      companyId={profile.company_id || ""}
      companyName={companyName}
      userEmail={user.email || ""}
    >
      {children}
    </AdminLayoutClient>
  );
}
