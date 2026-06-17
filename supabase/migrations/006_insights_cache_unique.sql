-- ============================================================================
-- Dashify: Enforce Uniqueness on AI Insights Cache Table
-- ============================================================================

-- TRUNCATE existing rows to avoid any existing duplicate key violations
TRUNCATE TABLE public.insights_cache;

-- Add UNIQUE constraint on (survey_id, table_id, active_columns_hash)
ALTER TABLE public.insights_cache 
ADD CONSTRAINT insights_cache_unique_combination UNIQUE (survey_id, table_id, active_columns_hash);
