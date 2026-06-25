-- ============================================================================
-- Dashify: Migration 007 - Add Client Admin Role
-- Allows profiles to have the 'client_admin' role and defines RLS rules.
-- ============================================================================

-- 1. Modify CHECK constraint on public.profiles role column
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'client_admin', 'analyst'));

-- 2. Drop existing RLS policies on profiles
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_update ON public.profiles;

-- 3. Create updated RLS policies allowing client admins to manage users in their company
-- Global admins can insert any profile. Client admins can only insert profiles in their own company.
CREATE POLICY profiles_insert ON public.profiles
    FOR INSERT
    WITH CHECK (
        public.requesting_user_role() = 'admin' OR 
        (public.requesting_user_role() = 'client_admin' AND company_id = public.requesting_company_id())
    );

-- Global admins can update any profile. Client admins can update profiles in their own company.
CREATE POLICY profiles_update ON public.profiles
    FOR UPDATE
    USING (
        public.requesting_user_role() = 'admin' OR 
        (public.requesting_user_role() = 'client_admin' AND company_id = public.requesting_company_id())
    )
    WITH CHECK (
        public.requesting_user_role() = 'admin' OR 
        (public.requesting_user_role() = 'client_admin' AND company_id = public.requesting_company_id())
    );
