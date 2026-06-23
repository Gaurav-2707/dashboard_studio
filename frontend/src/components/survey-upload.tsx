/**
 * Dashify — Survey Upload Component
 * Styled with Tailwind CSS matching Google Stitch specifications.
 */
"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { uploadSurvey, FlaskAPIError } from "@/lib/flask-api";
import { useRouter } from "next/navigation";

interface SurveyUploadProps {
  companyId: string;
  onUploadSuccess?: (surveyId: string) => void;
}

export default function SurveyUpload({ companyId, onUploadSuccess }: SurveyUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.match(/\.(xlsx|xlsm)$/i)) {
      setError("Only .xlsx and .xlsm files are supported.");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setError("Session expired. Please sign in again.");
        return;
      }

      const result = await uploadSurvey(session.access_token, file, companyId);

      if (result.is_duplicate) {
        setError(`This file was already uploaded.`);
        if (onUploadSuccess) {
          onUploadSuccess(result.survey_id);
        } else {
          setTimeout(() => {
            router.push(`/dashboard/${companyId}/survey/${result.survey_id}`);
          }, 1500);
        }
        return;
      }

      if (onUploadSuccess) {
        onUploadSuccess(result.survey_id);
      } else {
        router.push(`/dashboard/${companyId}/survey/${result.survey_id}`);
      }
      router.refresh();
    } catch (err) {
      if (err instanceof FlaskAPIError) {
        setError((err as any).message);
      } else {
        setError("Upload failed. Please try again.");
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xlsm"
        onChange={handleUpload}
        className="hidden"
        id="survey-file-input"
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="px-6 py-3 rounded-xl primary-gradient text-on-primary-container font-bold text-label-md flex items-center gap-xs shadow-xl shadow-primary/10 hover:shadow-[0_0_20px_rgba(245,158,11,0.3)] hover:scale-[1.02] hover:brightness-115 active:scale-95 transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
        id="upload-survey-btn"
      >
        {uploading ? (
          <>
            <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Uploading...
          </>
        ) : (
          <>
            <span className="material-symbols-outlined text-[20px]">
              upload_file
            </span>
            Upload Survey
          </>
        )}
      </button>
      {error && <p className="text-error text-label-sm max-w-[300px] text-right">{error}</p>}
    </div>
  );
}
