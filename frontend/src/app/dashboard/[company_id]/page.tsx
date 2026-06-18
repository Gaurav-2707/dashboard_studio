/**
 * Dashify — Workspace Hub (Server Container)
 * Fetches required data for tenant and passes to DashboardClient.
 */

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import DashboardClient from "@/components/dashboard-client";
import { listUsers } from "@/lib/flask-api";

interface SurveysPageProps {
  params: Promise<{ company_id: string }>;
}

export default async function SurveysPage({ params }: SurveysPageProps) {
  const { company_id } = await params;
  const supabase = await createClient();

  // 1. Authenticate user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // 2. Fetch user session access token
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token || "";

  // 3. Fetch company & profile details (role)
  const [companyResult, profileResult] = await Promise.all([
    supabase.from("companies").select("name").eq("id", company_id).single(),
    supabase.from("profiles").select("role").eq("id", user.id).single(),
  ]);

  const companyName = companyResult.data?.name || "Unknown";
  const role = (profileResult.data?.role as "admin" | "analyst") || "analyst";

  // 4. Fetch lists based on role permissions
  let surveys: any[] = [];
  let profiles: any[] = [];

  // Always fetch surveys metadata
  const { data: surveysData } = await supabase
    .from("parsed_surveys")
    .select("id, filename, uploaded_at")
    .eq("company_id", company_id)
    .order("uploaded_at", { ascending: false });
  surveys = surveysData || [];

  // If admin, fetch full users data for management tabs
  if (role === "admin") {
    profiles = await listUsers(accessToken, company_id).catch((err) => {
      console.error("Failed to fetch users from Flask API:", err);
      return [];
    });
  }

  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0a0f] flex">
        {/* Mock Sidebar Skeleton */}
        <aside className="h-screen w-64 fixed left-0 top-0 bg-surface-container/60 backdrop-blur-xl border-r border-outline-variant/10 flex flex-col py-md z-50 animate-pulse">
          <div className="px-md mb-xl flex items-center gap-xs">
            <div className="w-8 h-8 rounded-lg bg-white/10"></div>
            <div className="h-6 w-24 bg-white/15 rounded"></div>
          </div>
          <div className="flex-1 space-y-3 px-sm">
            <div className="h-10 bg-white/5 rounded-xl"></div>
            <div className="h-10 bg-white/5 rounded-xl"></div>
          </div>
          <div className="mt-auto p-md border-t border-outline-variant/10 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/10"></div>
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-white/15 rounded w-2/3"></div>
              <div className="h-3 bg-white/5 rounded w-1/2"></div>
            </div>
          </div>
        </aside>

        {/* Mock Content Layout Skeleton */}
        <main className="flex-1 p-8 ml-[260px] space-y-md animate-pulse">
          {/* Top Bar Header Skeleton */}
          <div className="h-16 border-b border-outline-variant/10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-6 w-16 bg-white/15 rounded"></div>
              <div className="h-6 w-4 bg-white/5 rounded"></div>
              <div className="h-6 w-32 bg-white/10 rounded"></div>
            </div>
            <div className="h-8 w-24 bg-white/10 rounded-full"></div>
          </div>

          {/* Action Bar / Tabs row skeleton */}
          <div className="flex justify-between items-center pt-8">
            <div className="flex gap-4">
              <div className="w-32 h-10 bg-white/10 rounded-xl"></div>
              <div className="w-24 h-10 bg-white/10 rounded-xl"></div>
            </div>
          </div>

          {/* Stats Cards Preview Row Skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-md pt-4">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div key={idx} className="glass-card p-md rounded-xl flex items-center gap-md border border-outline-variant/10">
                <div className="w-12 h-12 rounded-full bg-white/10"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-white/5 rounded w-1/2"></div>
                  <div className="h-6 bg-white/15 rounded w-1/3"></div>
                </div>
              </div>
            ))}
          </div>

          {/* Surveys Cards Grid Skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-md pt-6">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="glass-card p-md rounded-xl border border-outline-variant/10 h-48 flex flex-col justify-between animate-pulse">
                <div className="space-y-3">
                  <div className="w-12 h-12 rounded-lg bg-white/10"></div>
                  <div className="h-4 bg-white/15 rounded w-3/4"></div>
                </div>
                <div className="flex justify-between items-center border-t border-outline-variant/10 pt-3">
                  <div className="h-3 bg-white/5 rounded w-24"></div>
                  <div className="h-8 w-20 bg-white/10 rounded-lg"></div>
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    }>
      <DashboardClient
        companyId={company_id}
        companyName={companyName}
        initialSurveys={surveys}
        initialProfiles={profiles}
        role={role}
        accessToken={accessToken}
      />
    </Suspense>
  );
}
