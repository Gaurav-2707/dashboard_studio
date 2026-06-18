/**
 * Dashify — Shared TypeScript Types
 */

// ============================================================================
// Database types
// ============================================================================

export interface Company {
  id: string;
  name: string;
  status: "active" | "pending_deletion";
  deletion_scheduled_at: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  company_id: string | null;
  role: "admin" | "analyst";
  created_at: string;
}



export interface ParsedSurvey {
  id: string;
  company_id: string;
  uploaded_by: string;
  filename: string;
  file_hash: string;
  survey_data: SurveyData;
  uploaded_at: string;
}

// ============================================================================
// Survey data structure (JSONB)
// ============================================================================

export type SurveyData = Record<string, SurveyTable>;

export interface SurveyTable {
  title: string;
  data: Record<string, Record<string, number | string>>;
}

// ============================================================================
// JWT claims injected by the auth hook
// ============================================================================

export interface DashifyJWTClaims {
  sub: string;
  company_id: string | null;
  user_role: "admin" | "analyst" | "unassigned";
  company_status: "active" | "pending_deletion" | null;
  exp: number;
  iat: number;
}

// ============================================================================
// API types
// ============================================================================

export interface UploadResponse {
  survey_id: string;
  filename: string;
  table_count?: number;
  is_duplicate: boolean;
  message?: string;
}

export interface AggregateRequest {
  survey_id: string;
  table_number: number;
  column_ids: string[];
}

export interface AggregateResponse {
  survey_id: string;
  table_number: number;
  table_title: string;
  combined_column_name: string;
  is_mutually_exclusive: boolean;
  combined_base_weighted: number;
  combined_base_unweighted: number;
  rows: Record<string, number>;
}

export interface CreateCompanyRequest {
  name: string;
}

export interface CreateCompanyResponse {
  company_id: string;
  name: string;
}

// ============================================================================
// Chart types
// ============================================================================

export type ChartType = "Bar" | "Horizontal bar" | "Line" | "Pie";

export type SortOrder = "Highest to lowest" | "Lowest to highest" | "Original table order";

export interface ChartConfig {
  chartType: ChartType;
  chartTitle: string;
  axisLabel: string;
  paletteName: string;
  chartSize: "Small" | "Medium" | "Large";
  showLabels: boolean;
  roundValues: boolean;
  showGridlines: boolean;
  labelRotation: number;
  titlePosition: string;
  legendPosition: string;
  pieLabelMode: string;
  sortOrder: SortOrder;
  showAll: boolean;
  topN: number;
}

export const COLOR_PALETTES: Record<string, string[]> = {
  Default: ["#4C78A8", "#F58518", "#54A24B", "#E45756", "#72B7B2", "#B279A2"],
  Blue: ["#1f77b4", "#6baed6", "#9ecae1", "#c6dbef", "#08306b"],
  Green: ["#2ca02c", "#74c476", "#a1d99b", "#c7e9c0", "#005a32"],
  Warm: ["#e45756", "#f58518", "#ffbf79", "#b30000", "#7f2704"],
  Pastel: ["#9ecae1", "#fdd0a2", "#c7e9c0", "#fcbba1", "#dadaeb"],
  Grayscale: ["#252525", "#636363", "#969696", "#bdbdbd", "#d9d9d9"],
};

export const CHART_SIZES: Record<string, [number, number]> = {
  Small: [9, 5],
  Medium: [12, 6],
  Large: [15, 8],
};

export const NON_RESPONSE_ROWS = new Set([
  "UNWEIGHTED SAMPLE",
  "WEIGHTED SAMPLE",
  "MEAN",
  "MEDIAN",
  "MODE",
  "SD",
  "SE",
  "STD",
  "STANDARD ERROR",
  "STANDARD DEVIATION",
]);
