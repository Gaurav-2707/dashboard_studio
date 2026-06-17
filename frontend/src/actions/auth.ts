"use server";

/**
 * Dashify — Auth Server Actions
 */

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function signIn(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  // Get the user's company_id from the refreshed session
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.access_token) {
    try {
      const payload = JSON.parse(
        Buffer.from(session.access_token.split(".")[1], "base64").toString()
      );
      if (payload.company_id && payload.company_id !== "null") {
        redirect(`/dashboard/${payload.company_id}`);
      }
    } catch {
      // Fall through to default redirect
    }
  }

  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
