-- ============================================================================
-- Dashify: Custom Access Token Hook
-- Injects company_id and role into every JWT issued by Supabase Auth.
--
-- SETUP REQUIRED:
-- 1. Go to Supabase Dashboard → Authentication → Hooks
-- 2. Enable "Customize Access Token" hook
-- 3. Select this function: public.custom_access_token_hook
-- 4. Save and test with a login
-- ============================================================================

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

    IF user_role = 'admin' THEN
        -- Inject global admin claims (no specific company_id)
        claims := jsonb_set(claims, '{company_id}', 'null'::jsonb);
        claims := jsonb_set(claims, '{user_role}', '"admin"'::jsonb);
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
        -- No profile found — user exists in auth.users but hasn't been assigned
        -- to a company yet. Set explicit null claims so middleware can detect this.
        claims := jsonb_set(claims, '{company_id}', 'null'::jsonb);
        claims := jsonb_set(claims, '{user_role}', '"unassigned"'::jsonb);
        claims := jsonb_set(claims, '{company_status}', 'null'::jsonb);
    END IF;

    -- Write claims back and return
    event := jsonb_set(event, '{claims}', claims);
    RETURN event;
END;
$$;

-- Grant execute to supabase_auth_admin so the Auth service can call this hook
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- Revoke from public to prevent unauthorized calls
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM public;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM anon;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated;
