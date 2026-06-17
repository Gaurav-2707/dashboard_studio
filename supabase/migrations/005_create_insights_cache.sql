-- ============================================================================
-- Dashify: AI Insights Caching Table and Policies
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.insights_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id UUID NOT NULL REFERENCES public.parsed_surveys(id) ON DELETE CASCADE,
    table_id TEXT NOT NULL,
    active_columns TEXT[] NOT NULL,
    active_columns_hash TEXT NOT NULL,
    insights JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for instant lookup of cached results
CREATE INDEX IF NOT EXISTS insights_cache_lookup_idx 
ON public.insights_cache (survey_id, table_id, active_columns_hash);

-- Enable Row Level Security
ALTER TABLE public.insights_cache ENABLE ROW LEVEL SECURITY;

-- Grant permissions to PostgreSQL roles
GRANT ALL ON public.insights_cache TO postgres;
GRANT ALL ON public.insights_cache TO service_role;
GRANT SELECT, INSERT ON public.insights_cache TO authenticated;

-- Select policy: users can only see cached insights for surveys belonging to their company
CREATE POLICY insights_cache_select ON public.insights_cache
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.parsed_surveys ps
            WHERE ps.id = insights_cache.survey_id
            AND (ps.company_id = public.requesting_company_id() OR public.requesting_user_role() = 'admin')
        )
    );

-- Insert policy: users can only insert cached insights for surveys belonging to their company
CREATE POLICY insights_cache_insert ON public.insights_cache
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.parsed_surveys ps
            WHERE ps.id = insights_cache.survey_id
            AND (ps.company_id = public.requesting_company_id() OR public.requesting_user_role() = 'admin')
        )
    );
