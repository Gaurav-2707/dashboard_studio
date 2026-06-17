/**
 * Dashify — Auth Callback Route
 * Handles the OAuth/magic link callback from Supabase Auth
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Get company_id from the new session
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.access_token) {
        try {
          const payload = JSON.parse(
            Buffer.from(session.access_token.split(".")[1], "base64").toString()
          );
          if (payload.company_id && payload.company_id !== "null") {
            return NextResponse.redirect(
              new URL(`/dashboard/${payload.company_id}`, origin)
            );
          }
        } catch {
          // Fall through
        }
      }

      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // Auth error — redirect to login
  return NextResponse.redirect(new URL("/login", origin));
}
