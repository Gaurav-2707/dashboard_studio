-- Alter companies table to add industry column, and drop deletion_scheduled_at
ALTER TABLE public.companies 
ADD COLUMN IF NOT EXISTS industry TEXT,
DROP COLUMN IF EXISTS deletion_scheduled_at;

COMMENT ON COLUMN public.companies.industry IS 'The business sector/industry of the company (e.g., Automotive, FMCG, Tech).';
