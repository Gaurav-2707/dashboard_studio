-- ============================================================================
-- Dashify: Core Schema Migration
-- Multi-tenant survey analysis platform
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. COMPANIES
-- ============================================================================
CREATE TABLE public.companies (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'pending_deletion')),
    deletion_scheduled_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT companies_name_unique UNIQUE (name)
);

COMMENT ON TABLE public.companies IS 'Tenant root table. Each company is an isolated data silo.';
COMMENT ON COLUMN public.companies.status IS 'active = normal operation; pending_deletion = soft-deleted, scheduled for permanent removal after 14 days.';

-- ============================================================================
-- 2. PROFILES
-- Extends auth.users with tenant membership and role.
-- PK = auth.users.id (1:1 relationship, no orphan profiles possible).
-- ============================================================================
CREATE TABLE public.profiles (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id  UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'analyst'
                    CHECK (role IN ('admin', 'analyst')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_company ON public.profiles(company_id);

COMMENT ON TABLE public.profiles IS 'User profile linking auth.users to a company with a role.';

-- ============================================================================
-- 3. IGNORED AGENCIES
-- Per-company list of column headers to filter out during Excel parsing.
-- ============================================================================
CREATE TABLE public.ignored_agencies (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    agency_name TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ignored_agencies_company_name_unique UNIQUE (company_id, agency_name)
);

CREATE INDEX idx_ignored_agencies_company ON public.ignored_agencies(company_id);

COMMENT ON TABLE public.ignored_agencies IS 'Agency column names to exclude from parsed survey data. Seeded per-company at creation.';

-- ============================================================================
-- 4. PARSED SURVEYS
-- Stores the fully parsed Excel workbook as a single JSONB payload.
-- No raw files are stored on disk or in storage buckets.
-- ============================================================================
CREATE TABLE public.parsed_surveys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    filename    TEXT NOT NULL,
    file_hash   TEXT NOT NULL,
    survey_data JSONB NOT NULL DEFAULT '{}',
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_parsed_surveys_company ON public.parsed_surveys(company_id);
CREATE INDEX idx_parsed_surveys_hash ON public.parsed_surveys(company_id, file_hash);
CREATE INDEX idx_parsed_surveys_uploaded_by ON public.parsed_surveys(uploaded_by);

COMMENT ON TABLE public.parsed_surveys IS 'Parsed survey workbooks stored as structured JSONB. file_hash enables deduplication per company.';
COMMENT ON COLUMN public.parsed_surveys.survey_data IS 'Complete parsed workbook: { "table_num": { "title": "...", "data": { "row_label": { "col_name": value } } } }';
COMMENT ON COLUMN public.parsed_surveys.file_hash IS 'SHA-256 hash of the uploaded file bytes for deduplication.';

-- Grant necessary privileges to Supabase roles
GRANT ALL ON TABLE public.companies TO postgres, service_role, authenticated;
GRANT ALL ON TABLE public.profiles TO postgres, service_role, authenticated;
GRANT ALL ON TABLE public.ignored_agencies TO postgres, service_role, authenticated;
GRANT ALL ON TABLE public.parsed_surveys TO postgres, service_role, authenticated;

GRANT SELECT ON TABLE public.companies TO anon;

