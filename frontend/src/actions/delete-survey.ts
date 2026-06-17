"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

interface DeleteSurveyResult {
  success: boolean;
  error?: string;
}

export async function deleteSurveyAction(
  surveyId: string,
  companyId: string
): Promise<DeleteSurveyResult> {
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
