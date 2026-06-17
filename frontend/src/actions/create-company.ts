"use server";

/**
 * Dashify — Company Creation Server Action
 * Admin-only: creates a company and seeds default ignored agencies.
 */

import { createClient } from "@/lib/supabase/server";

interface CreateCompanyResult {
  success: boolean;
  company_id?: string;
  error?: string;
}

export async function createCompanyAction(
  formData: FormData
): Promise<CreateCompanyResult> {
  const companyName = formData.get("company_name") as string;
  const agenciesRaw = formData.get("ignored_agencies") as string;
  const industry = formData.get("industry") as string;

  if (!companyName?.trim()) {
    return { success: false, error: "Company name is required." };
  }

  if (companyName.trim().length > 200) {
    return { success: false, error: "Company name must be 200 characters or less." };
  }

  if (industry && industry.trim().length > 200) {
    return { success: false, error: "Industry must be 200 characters or less." };
  }

  const supabase = await createClient();

  // Verify the user is an admin
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "You must be logged in." };
  }

  // Check role from profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return { success: false, error: "Only admins can create companies." };
  }

  // Check for duplicate
  const { data: existing } = await supabase
    .from("companies")
    .select("id")
    .eq("name", companyName.trim())
    .limit(1);

  if (existing && existing.length > 0) {
    return { success: false, error: `Company "${companyName}" already exists.` };
  }

  // Create the company
  const { data: newCompany, error: createError } = await supabase
    .from("companies")
    .insert({
      name: companyName.trim(),
      industry: industry?.trim() || null,
    })
    .select("id")
    .single();

  if (createError || !newCompany) {
    return { success: false, error: "Failed to create company." };
  }

  // Seed ignored agencies
  const defaultAgencies = ["IPSOS", "KANTAR"];
  const customAgencies = agenciesRaw
    ? agenciesRaw
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean)
    : defaultAgencies;

  const agencyRows = customAgencies.map((name) => ({
    company_id: newCompany.id,
    agency_name: name,
  }));

  if (agencyRows.length > 0) {
    await supabase.from("ignored_agencies").insert(agencyRows);
  }

  return { success: true, company_id: newCompany.id };
}
