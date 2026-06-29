/**
 * Dashify — Survey Upload Drawer Component
 * Slide-over drawer with drag-and-drop support and customizable display name.
 */
"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { uploadSurvey, FlaskAPIError } from "@/lib/flask-api";
import { useRouter } from "next/navigation";

interface SurveyUploadProps {
  companyId: string;
  onUploadSuccess?: (surveyId: string, filename: string) => void;
}

export default function SurveyUpload({ companyId, onUploadSuccess }: SurveyUploadProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Reset drawer state when closed
  const closeDrawer = () => {
    setIsOpen(false);
    setSelectedFile(null);
    setDisplayName("");
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const selectFile = (file: File) => {
    if (!file.name.match(/\.(xlsx|xlsm)$/i)) {
      setError("Only .xlsx and .xlsm files are supported.");
      setSelectedFile(null);
      setDisplayName("");
      return;
    }
    setError(null);
    setSelectedFile(file);
    // Default display name to file name minus extension
    const baseName = file.name.replace(/\.[^/.]+$/, "");
    setDisplayName(baseName);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) selectFile(file);
  };

  const handleUploadSubmit = async () => {
    if (!selectedFile) return;

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

      const result = await uploadSurvey(
        session.access_token,
        selectedFile,
        companyId,
        displayName
      );

      if (result.is_duplicate) {
        setError("This file has already been uploaded.");
        return;
      }

      if (onUploadSuccess) {
        const finalName = displayName.trim() || (selectedFile ? selectedFile.name : "");
        onUploadSuccess(result.survey_id, finalName);
      }

      closeDrawer();
      router.refresh();
    } catch (err) {
      if (err instanceof FlaskAPIError) {
        setError((err as any).message);
      } else {
        setError("Upload failed. Please try again.");
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      {/* Upload Survey Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="px-6 py-3 rounded-xl primary-gradient text-on-primary-container font-bold text-label-md flex items-center gap-xs shadow-xl shadow-primary/10 hover:shadow-[0_0_20px_rgba(245,158,11,0.3)] hover:scale-[1.02] hover:brightness-115 active:scale-95 transition-all duration-150 cursor-pointer"
        id="upload-survey-btn"
      >
        <span className="material-symbols-outlined text-[20px]">upload_file</span>
        Upload Survey
      </button>

      {/* Drawer Overlay Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity duration-300"
          onClick={closeDrawer}
        />
      )}

      {/* Slide-over Drawer Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-full sm:w-[480px] bg-[#121620] border-l border-outline-variant/10 shadow-2xl z-50 flex flex-col justify-between transition-transform duration-300 ease-out ${isOpen ? "translate-x-0" : "translate-x-full"
          }`}
      >
        {/* Header */}
        <div className="p-6 border-b border-outline-variant/10 flex items-center justify-between">
          <div>
            <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">cloud_upload</span>
              Upload Survey Workbook
            </h3>
            <p className="text-body-sm text-on-surface-variant mt-1">
              Drag & drop or browse your files to begin analysis.
            </p>
          </div>
          <button
            onClick={closeDrawer}
            className="p-2 text-on-surface-variant hover:text-on-surface bg-white/5 hover:bg-white/10 rounded-xl transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 p-6 space-y-md overflow-y-auto custom-scrollbar">
          {/* Drag & Drop Area */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) selectFile(file);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center gap-4 text-center cursor-pointer transition-all duration-200 ${isDragging
                ? "border-primary bg-primary/10 scale-[0.99]"
                : "border-outline-variant/20 hover:border-primary/45 bg-white/5"
              }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xlsm"
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <span className="material-symbols-outlined text-[32px]">upload_file</span>
            </div>
            <div>
              <p className="font-bold text-label-lg text-on-surface">
                Drag and drop your Excel file here
              </p>
              <p className="text-body-xs text-on-surface-variant mt-1">
                or <span className="text-primary underline">browse your local folder</span>
              </p>
            </div>
            <div className="text-[10px] text-on-surface-variant/60 uppercase tracking-widest font-bold">
              Supported Formats: .xlsx, .xlsm
            </div>
          </div>

          {/* Selected File Details */}
          {selectedFile && (
            <div className="glass-panel p-md rounded-xl space-y-md border border-outline-variant/10 animate-fade-in">
              <div className="flex items-center gap-sm">
                <div className="p-2 bg-primary/10 rounded-lg text-primary">
                  <span className="material-symbols-outlined">insert_drive_file</span>
                </div>
                <div className="overflow-hidden">
                  <p className="text-label-sm font-bold text-on-surface truncate" title={selectedFile.name}>
                    {selectedFile.name}
                  </p>
                  <p className="text-[10px] text-on-surface-variant">
                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>
              </div>

              {/* Display Name Input */}
              <div className="space-y-1">
                <label className="text-[11px] text-on-surface-variant uppercase font-bold tracking-widest block">
                  Survey Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full bg-surface-container-high border border-outline-variant/30 rounded-lg text-on-surface py-2 px-3 focus:ring-1 focus:ring-primary outline-none text-xs"
                  placeholder="Enter custom survey name..."
                />
                <p className="text-[10px] text-on-surface-variant/60 italic">
                  This name will represent the survey throughout the workspace.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="p-md rounded-xl border border-error/20 bg-error/5 flex items-start gap-xs text-error">
              <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">error</span>
              <p className="text-xs font-medium leading-relaxed">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-outline-variant/10 flex items-center justify-end gap-md bg-white/2">
          <button
            onClick={closeDrawer}
            disabled={uploading}
            className="px-4 py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface font-bold text-label-md rounded-xl transition-all cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleUploadSubmit}
            disabled={uploading || !selectedFile}
            className="px-6 py-2 primary-gradient text-on-primary-container font-bold text-label-md rounded-xl flex items-center gap-xs shadow-lg shadow-primary/10 hover:brightness-110 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {uploading ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[18px]">publish</span>
                Upload
              </>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
