/**
 * Dashify — Typed Flask API Client
 * All calls include the user's Supabase access token for JWT verification.
 */

import type {
  AggregateRequest,
  AggregateResponse,
  CreateCompanyRequest,
  CreateCompanyResponse,
  UploadResponse,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

class FlaskAPIError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>
  ) {
    super(body.error as string || `API error: ${status}`);
    this.name = "FlaskAPIError";
  }
}

async function apiFetch<T>(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  let body: any;
  const contentType = res.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    body = await res.json();
  } else {
    const text = await res.text();
    body = { error: text || `HTTP error ${res.status}` };
  }

  if (!res.ok) {
    throw new FlaskAPIError(res.status, body);
  }

  return body as T;
}

// ============================================================================
// API Methods
// ============================================================================

/**
 * Upload an Excel survey file.
 */
export async function uploadSurvey(
  token: string,
  file: File,
  companyId?: string,
  customFilename?: string
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (companyId) {
    formData.append("company_id", companyId);
  }
  if (customFilename) {
    formData.append("filename", customFilename);
  }

  return apiFetch<UploadResponse>("/api/upload", token, {
    method: "POST",
    body: formData,
    // Don't set Content-Type — let the browser set it with the boundary
  });
}

/**
 * Compute intersection aggregation.
 */
export async function aggregate(
  token: string,
  payload: AggregateRequest
): Promise<AggregateResponse> {
  return apiFetch<AggregateResponse>("/api/aggregate", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * Create a new company (admin only).
 */
export async function createCompany(
  token: string,
  payload: CreateCompanyRequest
): Promise<CreateCompanyResponse> {
  return apiFetch<CreateCompanyResponse>("/api/companies", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * List all companies (admin only).
 */
export async function listCompanies(
  token: string
): Promise<{ companies: Array<Record<string, unknown>> }> {
  return apiFetch("/api/companies", token, { method: "GET" });
}

/**
 * Fetch parsed survey by ID on-the-fly.
 */
export async function getSurvey(
  token: string,
  surveyId: string
): Promise<{
  id: string;
  filename: string;
  uploaded_at: string;
  survey_data: Record<string, any>;
}> {
  return apiFetch(`\/api\/surveys\/${surveyId}`, token, { method: "GET" });
}

/**
 * Create a new analyst user for a company (admin only).
 */
export async function createUser(
  token: string,
  payload: { email: string; password?: string; company_id?: string; role?: string }
): Promise<{ id: string; email: string; company_id: string; role: string; created_at: string }> {
  return apiFetch("/api/companies/users", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * Delete a user (admin only).
 */
export async function deleteUser(
  token: string,
  userId: string
): Promise<{ message: string }> {
  return apiFetch(`/api/companies/users/${userId}`, token, {
    method: "DELETE",
  });
}

/**
 * List all users for a company (admin only).
 */
export async function listUsers(
  token: string,
  companyId: string
): Promise<Array<{ id: string; email: string; role: string; created_at: string }>> {
  return apiFetch(`/api/companies/users?company_id=${companyId}`, token, { method: "GET" });
}

/**
 * Add a new agency (admin only).
 */
export async function addAgency(
  token: string,
  payload: { agency_name: string; company_id?: string }
): Promise<{ id: string; agency_name: string; company_id: string; created_at: string }> {
  return apiFetch("/api/companies/agencies", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * Delete an agency (admin only).
 */
export async function deleteAgency(
  token: string,
  agencyId: string
): Promise<{ message: string }> {
  return apiFetch(`/api/companies/agencies/${agencyId}`, token, {
    method: "DELETE",
  });
}

/**
 * Generate AI survey insights (using LangChain Llama NIM backend).
 */
export async function getAIInsights(
  token: string,
  payload: {
    survey_id: string;
    table_id: string;
    chart_type: string;
    active_columns: string[];
    save_to_cache?: boolean;
  }
): Promise<{ insight: Array<{ Topic: string; Insight: string; Takeaway: string; "Data Reference"?: string }> }> {
  return apiFetch("/api/surveys/insights", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * Fetch context for a survey.
 */
export async function getSurveyContext(
  token: string,
  surveyId: string
): Promise<{ context: string }> {
  return apiFetch(`/api/surveys/${surveyId}/context`, token, { method: "GET" });
}

/**
 * Save/update context for a survey (admin only).
 */
export async function saveSurveyContext(
  token: string,
  surveyId: string,
  context: string
): Promise<{ success: boolean }> {
  return apiFetch(`/api/surveys/${surveyId}/context`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context }),
  });
}

/**
 * Reset a user's password (admin/client_admin only).
 */
export async function resetUserPassword(
  token: string,
  userId: string,
  password: string
): Promise<{ success: boolean; message: string }> {
  return apiFetch("/api/companies/users/reset-password", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, password }),
  });
}

export { FlaskAPIError };


