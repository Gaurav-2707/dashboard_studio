import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function IndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // User is logged in. Let's find their company ID and role from profiles.
  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id, role")
    .eq("id", user.id)
    .single();

  console.log("[ROOT PAGE PROFILE]:", JSON.stringify(profile));

  if (profile?.role === "admin") {
    redirect("/admin");
  }

  if (profile?.company_id) {
    redirect(`/dashboard/${profile.company_id}`);
  }

  // Profile not found or company not assigned yet, redirect to login
  redirect("/login");
}
