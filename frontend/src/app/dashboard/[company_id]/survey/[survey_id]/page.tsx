/**
 * Dashify — Direct Survey URL Redirector
 * Redirects direct bookmarks of survey detail pages to the unified dashboard view.
 */

import { redirect } from "next/navigation";

interface RedirectPageProps {
  params: Promise<{ company_id: string; survey_id: string }>;
}

export default async function SurveyRedirectPage({ params }: RedirectPageProps) {
  const { company_id, survey_id } = await params;
  redirect(`/dashboard/${company_id}?survey_id=${survey_id}`);
}
