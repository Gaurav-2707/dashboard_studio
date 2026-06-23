"use client";

import { deleteSurveyAction } from "@/actions/delete-survey";
import { useState } from "react";
import { useAlerts } from "@/components/alerts-provider";

interface DeleteSurveyButtonProps {
  surveyId: string;
  companyId: string;
  filename: string;
  onDeleteSuccess?: () => void;
}

export default function DeleteSurveyButton({
  surveyId,
  companyId,
  filename,
  onDeleteSuccess,
}: DeleteSurveyButtonProps) {
  const [deleting, setDeleting] = useState(false);
  const alerts = useAlerts();

  function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    alerts.showConfirm({
      title: "Delete Survey",
      message: `Are you sure you want to permanently delete the survey workbook "${filename}"?`,
      confirmLabel: "Delete Survey",
      isDestructive: true,
      onConfirm: async () => {
        setDeleting(true);
        const result = await deleteSurveyAction(surveyId, companyId);
        if (result.success) {
          if (onDeleteSuccess) {
            onDeleteSuccess();
          }
        } else {
          alerts.showAlert({
            title: "Error Deleting Survey",
            message: result.error || "Failed to delete survey.",
            isDestructive: true,
          });
          setDeleting(false);
        }
      },
    });
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="p-2 text-on-surface-variant hover:text-error hover:bg-error/10 rounded-lg transition-all inline-flex items-center z-10 cursor-pointer !shadow-none"
      title="Delete Survey"
    >
      <span className="material-symbols-outlined text-[20px]">
        {deleting ? "progress_activity" : "delete"}
      </span>
    </button>
  );
}
