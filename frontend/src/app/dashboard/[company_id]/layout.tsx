/**
 * Dashify — Dashboard Shell Layout
 * Sidebar navigation + main content area
 */

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Sidebar from "@/components/sidebar";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ company_id: string }>;
}) {
  const { company_id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Fetch company and profile info
  const [companyResult, profileResult] = await Promise.all([
    supabase.from("companies").select("name, status").eq("id", company_id).single(),
    supabase.from("profiles").select("role").eq("id", user.id).single(),
  ]);

  const companyName = companyResult.data?.name || "Unknown";
  const role = (profileResult.data?.role as "admin" | "analyst") || "analyst";
  const userEmail = user.email || "";

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0a0a0f" }}>
      <Sidebar
        companyId={company_id}
        companyName={companyName}
        userEmail={userEmail}
        role={role}
      />
      <main
        style={{
          flex: 1,
          padding: "2rem",
          marginLeft: "300px",
          overflowY: "auto",
        }}
      >
        {children}
      </main>
    </div>
  );
}
