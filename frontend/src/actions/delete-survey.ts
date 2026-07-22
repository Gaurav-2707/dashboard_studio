"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

interface DeleteSurveyResult {
  success: boolean;
  error?: string;
}

export async function deleteSurveyAction(
  surveyId: string,
  companyId: string
): Promise<DeleteSurveyResult> {
  // 0. Verify the caller has admin role before proceeding
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Not authenticated." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, company_id")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "admin" && profile.role !== "super_admin")) {
    return { success: false, error: "Forbidden: Only admins and super admins can delete surveys." };
  }

  // For tenant-bound admins, verify survey belongs to their company
  if (profile.company_id && profile.company_id !== companyId) {
    return { success: false, error: "Forbidden: Survey belongs to a different company." };
  }

  // 1. Delete associated cached insights first using admin client to bypass any RLS/privilege limits
  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error: cacheError } = await adminSupabase
    .from("insights_cache")
    .delete()
    .eq("survey_id", surveyId);

  if (cacheError) {
    console.error("Failed to delete insights cache for survey:", cacheError);
  }

  // 2. Delete the survey record using admin client with company scoping
  const { error } = await adminSupabase
    .from("parsed_surveys")
    .delete()
    .eq("id", surveyId)
    .eq("company_id", companyId);

  if (error) {
    return { success: false, error: "Failed to delete survey." };
  }

  revalidatePath(`/dashboard/${companyId}`);
  return { success: true };
}
