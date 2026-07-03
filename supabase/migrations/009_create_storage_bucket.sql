-- Create the 'surveys' private storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'surveys',
    'surveys',
    false,
    52428800, -- 50MB file limit
    ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel.sheet.macroEnabled.12', 'application/vnd.ms-excel']
)
ON CONFLICT (id) DO NOTHING;

-- Policy: Allow authenticated users to upload survey files only to their own company's folder prefix
CREATE POLICY "Users can upload surveys to their company folder" ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'surveys' AND (
            (storage.foldername(name))[1] = (SELECT company_id::text FROM public.profiles WHERE id = auth.uid())
            OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
        )
    );

-- Policy: Allow authenticated users to read survey files only from their own company's folder prefix
CREATE POLICY "Users can read their own company surveys" ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'surveys' AND (
            (storage.foldername(name))[1] = (SELECT company_id::text FROM public.profiles WHERE id = auth.uid())
            OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
        )
    );

-- Policy: Allow authenticated users to delete survey files only from their own company's folder prefix
CREATE POLICY "Users can delete their own company surveys" ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'surveys' AND (
            (storage.foldername(name))[1] = (SELECT company_id::text FROM public.profiles WHERE id = auth.uid())
            OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
        )
    );
