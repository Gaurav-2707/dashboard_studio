-- ============================================================================
-- Dashify: Migration 008 - Add Super Admin Role
-- ============================================================================

-- 1. Modify CHECK constraint on public.profiles role column to allow super_admin
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('super_admin', 'admin', 'client_admin', 'analyst'));

-- 2. Update requesting_user_role helper to map super_admin to admin for RLS policy checks
CREATE OR REPLACE FUNCTION public.requesting_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT CASE 
        WHEN auth.jwt() ->> 'user_role' = 'super_admin' THEN 'admin'
        ELSE auth.jwt() ->> 'user_role'
    END;
$$;

-- 3. Update Custom Access Token Hook to handle super_admin and admin
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    claims          JSONB;
    user_company_id UUID;
    user_role       TEXT;
    company_status  TEXT;
BEGIN
    -- Extract current claims from the event
    claims := event -> 'claims';

    -- Look up the user's profile to get their tenant binding
    SELECT p.company_id, p.role
    INTO user_company_id, user_role
    FROM public.profiles p
    WHERE p.id = (event ->> 'user_id')::uuid;

    IF user_role IN ('super_admin', 'admin') THEN
        -- Inject global admin claims (no specific company_id)
        claims := jsonb_set(claims, '{company_id}', 'null'::jsonb);
        claims := jsonb_set(claims, '{user_role}', to_jsonb(user_role));
        claims := jsonb_set(claims, '{company_status}', '"active"'::jsonb);
    ELSIF user_company_id IS NOT NULL THEN
        -- Inject tenant claims into the JWT
        claims := jsonb_set(claims, '{company_id}', to_jsonb(user_company_id::text));
        claims := jsonb_set(claims, '{user_role}', to_jsonb(user_role));

        -- Also inject company status so middleware can check without a DB call
        SELECT c.status
        INTO company_status
        FROM public.companies c
        WHERE c.id = user_company_id;

        IF company_status IS NOT NULL THEN
            claims := jsonb_set(claims, '{company_status}', to_jsonb(company_status));
        END IF;
    ELSE
        -- No profile found
        claims := jsonb_set(claims, '{company_id}', 'null'::jsonb);
        claims := jsonb_set(claims, '{user_role}', '"unassigned"'::jsonb);
        claims := jsonb_set(claims, '{company_status}', 'null'::jsonb);
    END IF;

    -- Write claims back and return
    event := jsonb_set(event, '{claims}', claims);
    RETURN event;
END;
$$;
