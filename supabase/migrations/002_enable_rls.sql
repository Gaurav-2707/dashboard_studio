-- ============================================================================
-- Dashify: Row-Level Security Policies
-- All policies use the company_id claim injected into JWTs by the auth hook.
-- ============================================================================

-- Helper: extract company_id from the current JWT
-- This avoids repeating the cast expression in every policy.
-- If the user is a global admin, this will return NULL.
CREATE OR REPLACE FUNCTION public.requesting_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT (auth.jwt() ->> 'company_id')::uuid;
$$;

CREATE OR REPLACE FUNCTION public.requesting_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT auth.jwt() ->> 'user_role';
$$;

-- ============================================================================
-- COMPANIES
-- ============================================================================
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- Users can only see their own company (global admin can see all)
CREATE POLICY companies_select ON public.companies
    FOR SELECT
    USING (id = public.requesting_company_id() OR public.requesting_user_role() = 'admin');

-- Only global admins can update companies
CREATE POLICY companies_update ON public.companies
    FOR UPDATE
    USING (public.requesting_user_role() = 'admin')
    WITH CHECK (public.requesting_user_role() = 'admin');

-- Global admin can insert new companies directly
CREATE POLICY companies_insert ON public.companies
    FOR INSERT
    WITH CHECK (public.requesting_user_role() = 'admin');

-- Global admin can delete companies
CREATE POLICY companies_delete ON public.companies
    FOR DELETE
    USING (public.requesting_user_role() = 'admin');

-- ============================================================================
-- PROFILES
-- ============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can see all profiles within their company (global admin can see all)
CREATE POLICY profiles_select ON public.profiles
    FOR SELECT
    USING (company_id = public.requesting_company_id() OR public.requesting_user_role() = 'admin');

-- Users can always see their own profile
CREATE POLICY profiles_select_self ON public.profiles
    FOR SELECT
    USING (id = auth.uid());

-- Only global admins can insert new profiles
CREATE POLICY profiles_insert ON public.profiles
    FOR INSERT
    WITH CHECK (public.requesting_user_role() = 'admin');

-- Only global admins can update profiles
CREATE POLICY profiles_update ON public.profiles
    FOR UPDATE
    USING (public.requesting_user_role() = 'admin')
    WITH CHECK (public.requesting_user_role() = 'admin');

-- ============================================================================
-- IGNORED AGENCIES
-- ============================================================================
ALTER TABLE public.ignored_agencies ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read their company's ignored agencies
CREATE POLICY ignored_agencies_select ON public.ignored_agencies
    FOR SELECT
    USING (company_id = public.requesting_company_id() OR public.requesting_user_role() = 'admin');

-- Only global admins can add ignored agencies
CREATE POLICY ignored_agencies_insert ON public.ignored_agencies
    FOR INSERT
    WITH CHECK (public.requesting_user_role() = 'admin');

-- Only global admins can remove ignored agencies
CREATE POLICY ignored_agencies_delete ON public.ignored_agencies
    FOR DELETE
    USING (public.requesting_user_role() = 'admin');

-- ============================================================================
-- PARSED SURVEYS
-- ============================================================================
ALTER TABLE public.parsed_surveys ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read surveys within their company (global admin can see all)
CREATE POLICY parsed_surveys_select ON public.parsed_surveys
    FOR SELECT
    USING (company_id = public.requesting_company_id() OR public.requesting_user_role() = 'admin');

-- Any analyst can upload surveys to their company; global admin can upload to any company
CREATE POLICY parsed_surveys_insert ON public.parsed_surveys
    FOR INSERT
    WITH CHECK (
        (company_id = public.requesting_company_id() AND uploaded_by = auth.uid())
        OR public.requesting_user_role() = 'admin'
    );

-- Only global admins can delete surveys
CREATE POLICY parsed_surveys_delete ON public.parsed_surveys
    FOR DELETE
    USING (public.requesting_user_role() = 'admin');
