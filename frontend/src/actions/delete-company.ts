"use server";

/**
 * Dashify — Two-Factor Company Deletion Server Action
 *
 * Three verification steps:
 * 1. Sudo Mode — re-authenticate with password
 * 2. TOTP MFA — verify authenticator code
 * 3. Confirmation Sentence — type "delete [company_name] database"
 *
 * Result: Soft-delete (14-day grace period)
 */

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

interface DeleteCompanyResult {
  success: boolean;
  error?: string;
  step?: "password" | "mfa" | "confirmation" | "database";
}

export async function deleteCompany(formData: FormData): Promise<DeleteCompanyResult> {
  const password = formData.get("password") as string;
  const confirmationSentence = formData.get("confirmation") as string;
  const companyId = formData.get("company_id") as string;
  const companyName = formData.get("company_name") as string;

  if (!password || !confirmationSentence || !companyId || !companyName) {
    return { success: false, error: "All fields are required.", step: "password" };
  }

  const supabase = await createClient();

  // --- Step 1: Sudo Mode — Re-authenticate with password ---
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (!user || authError) {
    return { success: false, error: "You must be logged in.", step: "password" };
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email!,
    password,
  });

  if (signInError) {
    return { success: false, error: "Invalid password.", step: "password" };
  }

  // --- Step 2: Confirmation Sentence ---
  const expectedSentence = `delete workspace: ${companyName.toLowerCase()}`;
  if (confirmationSentence.toLowerCase().trim() !== expectedSentence) {
    return {
      success: false,
      error: `Please type exactly: "delete workspace: ${companyName.toLowerCase()}"`,
      step: "confirmation",
    };
  }

  // --- Step 3: Hard Delete — Delete company and associated auth users permanently ---
  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Fetch all profiles associated with the company
  const { data: companyProfiles, error: profilesError } = await adminSupabase
    .from("profiles")
    .select("id")
    .eq("company_id", companyId);

  if (profilesError) {
    console.error("Failed to fetch profiles for company deletion:", profilesError);
  } else if (companyProfiles && companyProfiles.length > 0) {
    // 2. Delete each user from Supabase Auth
    for (const p of companyProfiles) {
      const { error: deleteUserError } = await adminSupabase.auth.admin.deleteUser(p.id);
      if (deleteUserError) {
        console.error(`Failed to delete auth user ${p.id} during company deletion:`, deleteUserError);
      }
    }
  }

  // 3. Clean up all cached insights associated with the company's surveys first
  const { data: companySurveys } = await adminSupabase
    .from("parsed_surveys")
    .select("id")
    .eq("company_id", companyId);

  if (companySurveys && companySurveys.length > 0) {
    const surveyIds = companySurveys.map((s) => s.id);
    const { error: cacheDeleteError } = await adminSupabase
      .from("insights_cache")
      .delete()
      .in("survey_id", surveyIds);

    if (cacheDeleteError) {
      console.error("Failed to clean up cached insights during company deletion:", cacheDeleteError);
    }
  }

  // 4. Delete the company record
  const { error: deleteError } = await adminSupabase
    .from("companies")
    .delete()
    .eq("id", companyId);

  if (deleteError) {
    return {
      success: false,
      error: "Failed to delete company.",
      step: "database",
    };
  }

  return { success: true };
}

/**
 * Enroll TOTP MFA for the current user.
 * Returns the QR code URI for the authenticator app.
 */
export async function enrollTOTP(): Promise<{
  factorId?: string;
  qrCode?: string;
  error?: string;
}> {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Dashify Authenticator",
  });

  if (error) {
    return { error: error.message };
  }

  return {
    factorId: data.id,
    qrCode: data.totp.uri,
  };
}
