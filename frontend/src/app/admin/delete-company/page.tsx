/**
 * Dashify — Delete Company Page
 * Three-factor verification: password + TOTP + confirmation sentence
 */
"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { deleteCompany, enrollTOTP } from "@/actions/delete-company";
import styles from "./delete.module.css";

function DeleteCompanyForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const companyId = searchParams.get("id") || "";
  const companyName = searchParams.get("name") || "";

  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    setError(null);

    formData.set("company_id", companyId);
    formData.set("company_name", companyName);

    const result = await deleteCompany(formData);

    if (result.success) {
      setSuccess(true);
    } else {
      setError(result.error || "Deletion failed.");
      setStep(result.step || null);
    }
    setSubmitting(false);
  }

  if (success) {
    return (
      <div className={styles.successCard}>
        <div className={styles.successIcon}>✓</div>
        <h2>Company Workspace Deleted</h2>
        <p>
          <strong>{companyName}</strong> workspace has been permanently deleted.
        </p>
        <button
          onClick={() => router.push("/admin")}
          className={styles.backBtn}
        >
          Back to Admin Panel
        </button>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.modal}>
        <div className={styles.warningIcon}>⚠️</div>
        <h2 className={styles.modalTitle}>Delete Company Workspace</h2>
        <p className={styles.modalDesc}>
          This action will permanently delete{" "}
          <strong>{companyName}</strong> workspace and all its associated data. This cannot be undone.
        </p>

        {error && (
          <div
            className={`${styles.alert} ${step === "password"
              ? styles.alertPassword
              : step === "mfa"
                ? styles.alertMfa
                : styles.alertConfirm
              }`}
          >
            {error}
          </div>
        )}

        <form action={handleSubmit}>
          {/* Step 1: Password */}
          <div className={styles.stepBox}>
            <div className={styles.stepHeader}>
              <span className={styles.stepNumber}>1</span>
              <span className={styles.stepLabel}>Re-enter your password</span>
            </div>
            <div style={{ position: "relative" }}>
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                required
                placeholder="Your password"
                className={styles.input}
                autoComplete="current-password"
                style={{ paddingRight: "2.75rem" }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                style={{
                  position: "absolute",
                  right: "10px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "rgba(255,255,255,0.4)",
                  display: "flex",
                  alignItems: "center",
                  padding: 0,
                }}
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
                  {showPassword ? "visibility_off" : "visibility"}
                </span>
              </button>
            </div>
          </div>

          {/* Step 2: Confirmation */}
          <div className={styles.stepBox}>
            <div className={styles.stepHeader}>
              <span className={styles.stepNumber}>2</span>
              <span className={styles.stepLabel}>
                Type &quot;delete workspace: {companyName.toLowerCase()} &quot; to
                confirm
              </span>
            </div>
            <input
              name="confirmation"
              type="text"
              required
              placeholder={`delete workspace: ${companyName.toLowerCase()}`}
              className={styles.input}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className={styles.deleteBtn}
          >
            {submitting ? "Deleting..." : "Permanently Delete Company Workspace"}
          </button>
        </form>

        <button
          onClick={() => router.push("/admin")}
          className={styles.cancelBtn}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function DeleteCompanyPage() {
  return (
    <Suspense fallback={<div style={{ color: "white", padding: "2rem" }}>Loading...</div>}>
      <DeleteCompanyForm />
    </Suspense>
  );
}
