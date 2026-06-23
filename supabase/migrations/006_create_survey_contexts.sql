-- ============================================================================
-- 6. SURVEY CONTEXTS
-- Stores admin-entered context for each survey to be fed to Tavily & Insight generators.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.survey_contexts (
    survey_id   UUID PRIMARY KEY REFERENCES public.parsed_surveys(id) ON DELETE CASCADE,
    context     TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.survey_contexts ENABLE ROW LEVEL SECURITY;

-- Allow any authenticated user to SELECT/READ context (needed for analysts and insight generation)
CREATE POLICY survey_contexts_select ON public.survey_contexts
    FOR SELECT
    USING (
        survey_id IN (
            SELECT id FROM public.parsed_surveys 
            WHERE company_id = public.requesting_company_id() 
            OR public.requesting_user_role() = 'admin'
        )
    );

-- Only admins can INSERT/UPDATE/DELETE context
CREATE POLICY survey_contexts_insert ON public.survey_contexts
    FOR INSERT
    WITH CHECK (public.requesting_user_role() = 'admin');

CREATE POLICY survey_contexts_update ON public.survey_contexts
    FOR UPDATE
    USING (public.requesting_user_role() = 'admin')
    WITH CHECK (public.requesting_user_role() = 'admin');

CREATE POLICY survey_contexts_delete ON public.survey_contexts
    FOR DELETE
    USING (public.requesting_user_role() = 'admin');

-- Grant necessary privileges
GRANT ALL ON TABLE public.survey_contexts TO postgres, service_role, authenticated;
