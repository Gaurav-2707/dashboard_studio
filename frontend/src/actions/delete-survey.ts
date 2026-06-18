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

  // 2. Delete the survey record
  const supabase = await createClient();

  const { error } = await supabase
    .from("parsed_surveys")
    .delete()
    .eq("id", surveyId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath(`/dashboard/${companyId}`);
  return { success: true };
}
