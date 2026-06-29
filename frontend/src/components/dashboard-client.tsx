/**
 * Dashify — Single-Page Dashboard Coordinator Component
 * Enforces role-based permissions (Admins vs Analysts) and renders charts in-place.
 */
"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSurvey, createUser, deleteUser, getSurveyContext, saveSurveyContext, resetUserPassword } from "@/lib/flask-api";
import { signOut } from "@/actions/auth";
import SurveyUpload from "@/components/survey-upload";
import DeleteSurveyButton from "@/components/delete-survey-button";
import ChartViewer from "@/components/chart-viewer";
import { useAlerts } from "@/components/alerts-provider";

interface DashboardClientProps {
  companyId: string;
  companyName: string;
  initialSurveys: any[];
  initialProfiles: any[];
  role: "admin" | "client_admin" | "analyst";
  accessToken: string;
}

export default function DashboardClient({
  companyId,
  companyName,
  initialSurveys,
  initialProfiles,
  role,
  accessToken,
}: DashboardClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const querySurveyId = searchParams.get("survey_id");

  const [activeSurveyId, setActiveSurveyId] = useState<string | null>(null);
  const [activeSurveyFilename, setActiveSurveyFilename] = useState<string>("");
  const [surveyData, setSurveyData] = useState<any>(null);
  const [loadingSurvey, setLoadingSurvey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alerts = useAlerts();

  // Survey Context States
  const [showContextModal, setShowContextModal] = useState(false);
  const [contextSurveyId, setContextSurveyId] = useState<string | null>(null);
  const [contextSurveyFilename, setContextSurveyFilename] = useState<string>("");
  const [contextValue, setContextValue] = useState<string>("");
  const [loadingContext, setLoadingContext] = useState(false);
  const [savingContext, setSavingContext] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);

  const handleOpenContextModal = async (surveyId: string, filename: string) => {
    setContextSurveyId(surveyId);
    setContextSurveyFilename(filename);
    setContextValue("");
    setContextError(null);
    setLoadingContext(true);
    setShowContextModal(true);
    try {
      const data = await getSurveyContext(accessToken, surveyId);
      setContextValue(data.context || "");
    } catch (err: any) {
      console.error("Error loading survey context:", err);
      setContextError(err.message || "Failed to load context.");
    } finally {
      setLoadingContext(false);
    }
  };

  const handleSaveContext = async () => {
    if (!contextSurveyId) return;
    setSavingContext(true);
    setContextError(null);
    try {
      await saveSurveyContext(accessToken, contextSurveyId, contextValue);
      setShowContextModal(false);
      alerts.showAlert({
        title: "Success",
        message: "Survey context updated successfully. Any cached insights for this survey have been invalidated.",
        isDestructive: false,
      });
    } catch (err: any) {
      console.error("Error saving survey context:", err);
      setContextError(err.message || "Failed to save context.");
    } finally {
      setSavingContext(false);
    }
  };

  // Derived permission: can this user manage workspace users?
  const canManageUsers = role === "admin" || role === "client_admin";

  // Tab states (for admins and client_admins)
  const [activeTab, setActiveTab] = useState<"surveys" | "users">("surveys");
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [deletingSurveyId, setDeletingSurveyId] = useState<string | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close user menu when clicking outside
  useEffect(() => {
    if (!showUserMenu) return;
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showUserMenu]);


  // Keep track of surveys in state so we can react to deletions immediately
  const [surveys, setSurveys] = useState(initialSurveys);
  const [profiles, setProfiles] = useState(initialProfiles);



  // Modal and user creation states
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"analyst" | "client_admin">("analyst");
  const [creatingUser, setCreatingUser] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [showModalPassword, setShowModalPassword] = useState(false);

  // Password reset states
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetUserEmail, setResetUserEmail] = useState("");
  const [resetPasswordVal, setResetPasswordVal] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const handleGenerateResetPassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$";
    const array = new Uint32Array(12);
    crypto.getRandomValues(array);
    let generated = "";
    for (let i = 0; i < 12; i++) {
      generated += chars.charAt(array[i] % chars.length);
    }
    setResetPasswordVal(generated);
    setShowResetPassword(true);
  };

  const handleOpenResetModal = (targetUserId: string, targetEmail: string) => {
    setResetUserId(targetUserId);
    setResetUserEmail(targetEmail);
    setResetPasswordVal("");
    setShowResetPassword(false);
    setResetSuccess(false);
    setResetError(null);
    setShowResetModal(true);
  };

  const handleResetPasswordSubmit = async () => {
    if (!resetUserId || !resetPasswordVal) {
      setResetError("Password is required.");
      return;
    }
    if (resetPasswordVal.length < 6) {
      setResetError("Password must be at least 6 characters long.");
      return;
    }

    setResetting(true);
    setResetError(null);

    try {
      await resetUserPassword(accessToken, resetUserId, resetPasswordVal);
      setResetSuccess(true);
      alerts.showAlert({ title: "Success", message: `Password for ${resetUserEmail} has been updated.` });
    } catch (err: any) {
      setResetError(err.error || err.message || "Failed to reset password.");
    } finally {
      setResetting(false);
    }
  };

  const handleGeneratePassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$";
    const array = new Uint32Array(12);
    crypto.getRandomValues(array);
    let generated = "";
    for (let i = 0; i < 12; i++) {
      generated += chars.charAt(array[i] % chars.length);
    }
    setNewUserPassword(generated);
    setShowModalPassword(true);
  };



  // Decode JWT sub to find the current user ID to prevent self-deletion
  const currentUserId = (() => {
    try {
      const base64Url = accessToken.split(".")[1];
      const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
      const jsonPayload = decodeURIComponent(
        window.atob(base64)
          .split("")
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      );
      return JSON.parse(jsonPayload).sub || null;
    } catch {
      return null;
    }
  })();

  const handleCreateUser = async () => {
    if (!newUserEmail || !newUserPassword) {
      setModalError("Email and password are required.");
      return;
    }
    if (newUserPassword.length < 6) {
      setModalError("Password must be at least 6 characters long.");
      return;
    }
    setCreatingUser(true);
    setModalError(null);
    try {
      const user = await createUser(accessToken, {
        email: newUserEmail,
        password: newUserPassword,
        company_id: companyId,
        role: newUserRole,
      });
      const newProfile = {
        id: user.id,
        email: newUserEmail,
        role: user.role,
        created_at: user.created_at,
      };
      setProfiles((prev) => [newProfile, ...prev]);
      setShowAddUserModal(false);
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserRole("analyst");
      alerts.showAlert({
        title: "Success",
        message: `User '${newUserEmail}' created successfully.`,
        isDestructive: false,
      });
      router.refresh();
    } catch (err: any) {
      console.error("Error creating user:", err);
      setModalError(err.message || "Failed to create user.");
    } finally {
      setCreatingUser(false);
    }
  };

  const handleDeleteUser = (userId: string) => {
    if (userId === currentUserId) {
      alerts.showAlert({
        title: "Action Denied",
        message: "You cannot remove your own user account.",
        isDestructive: false,
      });
      return;
    }

    alerts.showConfirm({
      title: "Remove User",
      message: "Are you sure you want to permanently delete this user? This will revoke their access immediately.",
      confirmLabel: "Delete User",
      isDestructive: true,
      onConfirm: async () => {
        setDeletingUserId(userId);
        try {
          await deleteUser(accessToken, userId);
          // Wait briefly to show the pulsing animation clearly
          await new Promise((resolve) => setTimeout(resolve, 800));
          setProfiles((prev) => prev.filter((p) => p.id !== userId));
          router.refresh();
        } catch (err: any) {
          console.error("Error deleting user:", err);
          alerts.showAlert({
            title: "Error Deleting User",
            message: err.message || "Failed to delete user.",
            isDestructive: true,
          });
        } finally {
          setDeletingUserId(null);
        }
      },
    });
  };



  useEffect(() => {
    setSurveys(initialSurveys);
  }, [initialSurveys]);

  useEffect(() => {
    setProfiles(initialProfiles);
  }, [initialProfiles]);



  // Sync with searchParams on load
  useEffect(() => {
    if (querySurveyId) {
      const matched = surveys.find((s) => s.id === querySurveyId);
      if (matched) {
        setActiveSurveyId(querySurveyId);
        setActiveSurveyFilename(matched.filename);
      } else {
        setActiveSurveyId(null);
        setSurveyData(null);
      }
    } else {
      setActiveSurveyId(null);
      setSurveyData(null);
    }
  }, [querySurveyId, surveys]);

  // Load survey data when activeSurveyId changes
  useEffect(() => {
    if (!activeSurveyId) {
      setSurveyData(null);
      setError(null);
      return;
    }

    const surveyId = activeSurveyId;

    async function loadData() {
      setLoadingSurvey(true);
      setError(null);
      try {
        const parsed = await getSurvey(accessToken, surveyId);
        setSurveyData(parsed.survey_data || {});
      } catch (err: any) {
        console.error("Error loading survey data on-the-fly:", err);
        setError(err.message || "Failed to parse survey data.");
      } finally {
        setLoadingSurvey(false);
      }
    }

    loadData();
  }, [activeSurveyId, accessToken]);

  const handleUploadSuccess = (surveyId: string, filename: string) => {
    router.refresh();
    alerts.showAlert({
      title: "Success",
      message: `Survey report '${filename}' uploaded and parsed successfully.`,
      isDestructive: false,
    });
  };

  const handleDeleteSuccess = (surveyId: string) => {
    // If the currently analyzed survey was deleted, clear selection
    if (activeSurveyId === surveyId) {
      setActiveSurveyId(null);
      setSurveyData(null);
    }
    // Update local surveys list
    setSurveys((prev) => prev.filter((s) => s.id !== surveyId));
    router.refresh();
  };

  // Render Chart Viewer if a survey is actively selected
  if (activeSurveyId) {
    const filename = activeSurveyFilename || surveys.find(s => s.id === activeSurveyId)?.filename || "Survey File";

    return (
      <div className="space-y-md">
        {/* Back navigation header */}
        <div className="flex items-center justify-between border-b border-outline-variant/10 pb-md mb-md">
          <button
            onClick={() => {
              setActiveSurveyId(null);
              setSurveyData(null);
              router.push(`/dashboard/${companyId}`);
            }}
            className="flex items-center gap-xs px-4 py-2 bg-surface-container-high hover:bg-surface-container-highest border border-outline-variant/20 rounded-xl text-primary font-bold text-label-md transition-all active:scale-95 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back to Workspace
          </button>

          {role === "admin" && (
            <DeleteSurveyButton
              surveyId={activeSurveyId}
              companyId={companyId}
              filename={filename}
              onDeleteStart={() => setDeletingSurveyId(activeSurveyId)}
              onDeleteSuccess={() => {
                setDeletingSurveyId(null);
                handleDeleteSuccess(activeSurveyId);
              }}
              onDeleteError={() => setDeletingSurveyId(null)}
            />
          )}
        </div>

        {loadingSurvey && (
          <div className="space-y-md animate-pulse">
            {/* Header label explaining on-demand parsing */}
            <div className="p-4 bg-primary/10 border border-primary/20 rounded-2xl flex items-center gap-md">
              <span className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></span>
              <p className="text-label-md font-bold text-primary">
                Parsing Excel Workbook On-Demand... Please wait while content is parsed and decoded.
              </p>
            </div>

            {/* Back navigation header skeleton */}
            <div className="flex items-center justify-between border-b border-outline-variant/10 pb-md mb-md">
              <div className="w-32 h-10 bg-white/10 rounded-xl"></div>
              <div className="w-24 h-10 bg-white/10 rounded-xl"></div>
            </div>

            {/* Main Dashboard Skeleton Grid */}
            <div className="grid grid-cols-12 gap-6">
              {/* Left Controls Column (4 cols) */}
              <div className="col-span-12 lg:col-span-4 space-y-md">
                <div className="glass-panel p-md rounded-2xl border border-outline-variant/10 space-y-4">
                  <div className="h-6 w-1/2 bg-white/15 rounded"></div>
                  <div className="h-4 w-3/4 bg-white/10 rounded"></div>
                  <div className="space-y-2 pt-2">
                    <div className="h-10 bg-white/5 rounded-lg"></div>
                    <div className="h-10 bg-white/5 rounded-lg"></div>
                    <div className="h-10 bg-white/5 rounded-lg"></div>
                  </div>
                </div>
                <div className="glass-panel p-md rounded-2xl border border-outline-variant/10 space-y-4">
                  <div className="h-6 w-1/3 bg-white/15 rounded"></div>
                  <div className="h-10 bg-white/5 rounded-lg"></div>
                </div>
              </div>

              {/* Right Chart Column (8 cols) */}
              <div className="col-span-12 lg:col-span-8 space-y-md">
                <div className="glass-panel p-6 rounded-3xl border border-outline-variant/10 h-[500px] flex flex-col justify-between">
                  <div className="flex justify-between items-center">
                    <div className="h-6 w-1/3 bg-white/15 rounded"></div>
                    <div className="flex gap-2">
                      <div className="h-8 w-16 bg-white/10 rounded-lg"></div>
                      <div className="h-8 w-16 bg-white/10 rounded-lg"></div>
                    </div>
                  </div>
                  {/* Glowing bars simulation */}
                  <div className="flex-1 flex items-end justify-between px-6 pt-12 pb-6 gap-4">
                    <div className="w-full bg-white/5 rounded-t-lg h-[40%]"></div>
                    <div className="w-full bg-white/5 rounded-t-lg h-[65%]"></div>
                    <div className="w-full bg-white/5 rounded-t-lg h-[90%]"></div>
                    <div className="w-full bg-white/5 rounded-t-lg h-[50%]"></div>
                    <div className="w-full bg-white/5 rounded-t-lg h-[75%]"></div>
                  </div>
                  <div className="h-4 w-1/2 bg-white/10 rounded mx-auto mt-4"></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="py-xl glass-panel rounded-3xl border border-dashed border-error/30 flex flex-col items-center justify-center text-center">
            <span className="material-symbols-outlined text-[3rem] text-error mb-md">error</span>
            <h4 className="font-headline-sm text-headline-sm font-bold text-error mb-xs">
              Parsing Error
            </h4>
            <p className="text-body-md text-on-surface-variant max-w-[384px] mb-md">
              {error}
            </p>
            <button
              onClick={() => {
                setActiveSurveyId(null);
                router.push(`/dashboard/${companyId}`);
              }}
              className="px-4 py-2 bg-surface-container hover:bg-surface-container-high rounded-xl text-label-md font-bold transition-all cursor-pointer"
            >
              Return to Surveys
            </button>
          </div>
        )}

        {!loadingSurvey && !error && surveyData && (
          <ChartViewer
            surveyId={activeSurveyId}
            filename={filename}
            surveyData={surveyData}
            accessToken={accessToken}
            role={role}
            companyId={companyId}
          />
        )}
      </div>
    );
  }

  // Otherwise, render Workspace Grid
  return (
    <div className="relative">
      <header className="fixed top-0 right-0 w-[calc(100%-300px)] h-16 bg-surface-dim/80 backdrop-blur-md border-b border-outline-variant/10 z-40 flex items-center justify-between px-gutter">
        <div className="flex items-center gap-4">
          <Link
            href={role === "admin" ? "/admin" : `/dashboard/${companyId}`}
            className="font-headline-md text-headline-md font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary hover:opacity-90 transition-opacity cursor-pointer"
          >
            PValue Analytics
          </Link>
          <span className="text-outline-variant/60 text-headline-md font-light">/</span>
          <h2 className="font-headline-md text-headline-md font-medium text-on-surface">
            {companyName} Workspace
          </h2>
        </div>

        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu((v) => !v)}
            className="flex items-center gap-xs bg-surface-container-high/40 hover:bg-surface-container-highest/60 rounded-full py-1.5 px-3 border border-outline-variant/10 transition-colors cursor-pointer"
            id="user-menu-btn"
          >
            <span className="material-symbols-outlined text-[18px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
              {role === "admin" ? "admin_panel_settings" : role === "client_admin" ? "supervised_user_circle" : "person"}
            </span>
            <span className="text-label-sm font-bold text-on-surface-variant">
              {role === "admin" ? "Admin" : role === "client_admin" ? "Client Admin" : "Analyst"}
            </span>
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant transition-transform duration-200" style={{ transform: showUserMenu ? "rotate(180deg)" : "rotate(0deg)" }}>
              expand_more
            </span>
          </button>

          {showUserMenu && (
            <div className="absolute right-0 top-full mt-2 w-44 bg-surface-container-low border border-outline-variant/20 rounded-xl shadow-2xl overflow-hidden z-50 animate-fade-in">
              <div className="px-4 py-3 border-b border-outline-variant/10">
                <p className="text-[11px] text-on-surface-variant uppercase tracking-widest font-bold">Signed in as</p>
                <p className="text-label-sm font-bold text-on-surface truncate mt-0.5">{role === "admin" ? "Admin" : role === "client_admin" ? "Client Admin" : "Analyst"}</p>
              </div>
              <form action={signOut}>
                <button
                  type="submit"
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-label-sm text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors cursor-pointer"
                  id="top-bar-sign-out-btn"
                >
                  <span className="material-symbols-outlined text-[18px]">logout</span>
                  Logout
                </button>
              </form>
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <section className="pt-24 px-4 pb-xl max-w-container-max mx-auto">
        {/* Navigation Tabs (Only rendered for admins) */}
        {canManageUsers ? (
          <div className="flex border-b border-outline-variant/20 mb-lg">
            <button
              onClick={() => setActiveTab("surveys")}
              className={`px-md py-4 font-bold border-b-2 flex items-center gap-2 transition-all cursor-pointer ${activeTab === "surveys"
                ? "text-primary border-primary"
                : "text-on-surface-variant border-transparent hover:text-on-surface"
                }`}
            >
              <span className="material-symbols-outlined text-[20px]">upload_file</span>
              Surveys & Files
            </button>
            <button
              onClick={() => setActiveTab("users")}
              className={`px-md py-4 font-bold border-b-2 flex items-center gap-2 transition-all cursor-pointer ${activeTab === "users"
                ? "text-primary border-primary"
                : "text-on-surface-variant border-transparent hover:text-on-surface"
                }`}
            >
              <span className="material-symbols-outlined text-[20px]">group</span>
              Users
            </button>
          </div>
        ) : null}

        {/* Dynamic Tab Rendering */}
        {(activeTab === "surveys" || !canManageUsers) && (
          <>
            {/* Action Bar (Admins see upload button) */}
            <div className="flex flex-wrap items-center justify-between gap-md mb-lg">
              <div>
                <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface">
                  Survey Reports
                </h3>
                <p className="text-body-md text-on-surface-variant">
                  Select a survey card below to view data charts and run cross-tab analysis.
                </p>
              </div>
              {role === "admin" && (
                <SurveyUpload
                  companyId={companyId}
                  onUploadSuccess={handleUploadSuccess}
                />
              )}
            </div>

            {/* Stats Cards Preview */}
            <div className={`grid grid-cols-1 gap-md mb-lg ${canManageUsers ? "md:grid-cols-2" : "md:grid-cols-1"}`}>
              <div className="glass-card p-md rounded-xl flex items-center gap-md">
                <div className="w-12 h-12 rounded-full bg-secondary/10 flex items-center justify-center text-secondary">
                  <span className="material-symbols-outlined">chart_data</span>
                </div>
                <div>
                  <p className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-wider">
                    Total Surveys
                  </p>
                  <h4 className="text-headline-md font-bold">{surveys.length}</h4>
                </div>
              </div>
              {canManageUsers && (
                <div className="glass-card p-md rounded-xl flex items-center gap-md">
                  <div className="w-12 h-12 rounded-full bg-tertiary/10 flex items-center justify-center text-tertiary">
                    <span className="material-symbols-outlined">group</span>
                  </div>
                  <div>
                    <p className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-wider">
                      Active Users
                    </p>
                    <h4 className="text-headline-md font-bold text-tertiary">{profiles.length}</h4>
                  </div>
                </div>
              )}
            </div>



            {/* Survey Grid */}
            {surveys.length === 0 ? (
              <div className="mt-xl py-xl glass-panel rounded-3xl border border-dashed border-outline-variant/30 flex flex-col items-center justify-center text-center">
                <div className="w-64 h-64 mb-md relative overflow-hidden rounded-2xl flex items-center justify-center text-[5rem]">
                  🔮
                </div>
                <h3 className="font-headline-md text-headline-md font-bold text-on-surface mb-xs">
                  No Surveys Found
                </h3>
                <p className="text-body-md text-on-surface-variant max-w-[384px] mb-lg">
                  {canManageUsers
                    ? "Upload your first Excel survey workbook to get started with cross-tab analysis."
                    : "No surveys have been uploaded to this workspace yet."}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-md">
                {surveys.map((survey: any) => {
                  const uploadDate = new Date(survey.uploaded_at).toLocaleDateString(
                    "en-IN",
                    { day: "numeric", month: "short", year: "numeric" }
                  );
                  const isDeleting = deletingSurveyId === survey.id;

                  return (
                    <div
                      key={survey.id}
                      onClick={() => {
                        if (isDeleting) return;
                        setActiveSurveyId(survey.id);
                        setActiveSurveyFilename(survey.filename);
                        router.push(`/dashboard/${companyId}?survey_id=${survey.id}`);
                      }}
                      className={`glass-card p-md rounded-xl flex flex-col h-full relative group cursor-pointer transition-colors ${
                        isDeleting
                          ? "animate-pulse border-red-500/30 bg-red-500/5 text-red-300 opacity-60 pointer-events-none"
                          : "hover:border-primary/40"
                      }`}
                      id={`survey-card-${survey.id}`}
                    >
                      {role === "admin" && (
                        <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenContextModal(survey.id, survey.filename);
                            }}
                            className="p-2 text-on-surface-variant hover:bg-primary/20 hover:text-primary rounded-lg transition-all inline-flex items-center z-10 cursor-pointer !shadow-none"
                            title="Edit Survey Context"
                          >
                            <span className="material-symbols-outlined text-[20px]">
                              edit_note
                            </span>
                          </button>
                          <DeleteSurveyButton
                            surveyId={survey.id}
                            companyId={companyId}
                            filename={survey.filename}
                            onDeleteStart={() => setDeletingSurveyId(survey.id)}
                            onDeleteSuccess={() => {
                              setDeletingSurveyId(null);
                              handleDeleteSuccess(survey.id);
                            }}
                            onDeleteError={() => setDeletingSurveyId(null)}
                          />
                        </div>
                      )}
                      <div className="flex items-center gap-sm mb-md pr-24">
                        <div className="p-2 bg-surface-container-highest rounded-lg text-primary">
                          <span className="material-symbols-outlined">description</span>
                        </div>
                        <div className="overflow-hidden">
                          <h5
                            className="font-bold text-on-surface truncate pr-4"
                            title={survey.filename}
                          >
                            {survey.filename}
                          </h5>
                          <p className="text-label-sm text-on-surface-variant">
                            Uploaded {uploadDate}
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-sm mb-lg">
                        <div className="bg-surface-container-low/50 p-2 rounded-lg border border-outline-variant/10">
                          <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest">
                            Format
                          </p>
                          <p className="text-label-md font-bold truncate">Excel Workbook</p>
                        </div>
                        <div className="bg-surface-container-low/50 p-2 rounded-lg border border-outline-variant/10">
                          <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest">
                            Status
                          </p>
                          <p className="text-label-md font-bold text-secondary">Ready</p>
                        </div>

                      </div>
                      <div className="mt-auto flex items-center justify-between pt-md border-t border-outline-variant/10">
                        <span className="text-label-sm text-on-surface-variant">
                          Click to select
                        </span>
                        <span className="flex items-center gap-xs text-primary font-bold group-hover:gap-sm transition-all duration-200">
                          Analyze{" "}
                          <span className="material-symbols-outlined text-[20px]">
                            arrow_forward
                          </span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {canManageUsers && activeTab === "users" && (
          <div className="glass-panel rim-light rounded-xl overflow-hidden shadow-2xl">
            <div className="p-md border-b border-outline-variant/20 bg-white/5 flex flex-wrap items-center justify-between gap-md">
              <div>
                <h3 className="text-headline-md font-bold text-on-surface">Workspace Members</h3>
                <p className="text-on-surface-variant text-label-md">Manage analyst and admin access for this workspace.</p>
              </div>
              <button
                onClick={() => setShowAddUserModal(true)}
                className="flex items-center gap-xs px-4 py-2 bg-primary/20 hover:bg-primary/30 border border-primary/30 rounded-xl text-primary font-bold text-label-md transition-all active:scale-95 cursor-pointer !shadow-none"
              >
                <span className="material-symbols-outlined text-[20px]">add</span>
                Add New User
              </button>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/5 border-b border-outline-variant/20">
                  <th className="px-md py-4 font-label-md text-on-surface-variant">User Email ID</th>
                  <th className="px-md py-4 font-label-md text-on-surface-variant">System Role</th>
                  <th className="px-md py-4 font-label-md text-on-surface-variant">Member Since</th>
                  <th className="px-md py-4 font-label-md text-on-surface-variant text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {profiles.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-md py-8 text-center text-on-surface-variant">
                      No members bound to this company.
                    </td>
                  </tr>
                ) : (
                  profiles.map((profile) => {
                    const isDeleting = deletingUserId === profile.id;
                    return (
                      <tr
                        key={profile.id}
                        className={`transition-colors ${
                          isDeleting
                            ? "animate-pulse bg-red-500/10 text-red-300 opacity-60 pointer-events-none"
                            : "hover:bg-white/5"
                        }`}
                      >
                        <td className="px-md py-5 text-on-surface text-label-md">
                          {profile.email || "Unknown User"}
                        </td>
                        <td className="px-md py-5">
                          <span
                            className={`px-3 py-1 rounded-full text-[12px] font-bold uppercase tracking-tight ${profile.role === "admin"
                              ? "bg-primary/20 text-primary"
                              : profile.role === "client_admin"
                                ? "bg-tertiary/20 text-tertiary"
                                : "bg-secondary/20 text-secondary"
                              }`}
                          >
                            {profile.role === "client_admin" ? "client admin" : profile.role}
                          </span>
                        </td>
                        <td className="px-md py-5 text-on-surface-variant font-label-md">
                          {new Date(profile.created_at).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </td>
                        <td className="px-md py-5 text-center">
                          {profile.id === currentUserId ? (
                            <span className="text-[12px] text-on-surface-variant italic font-medium block text-center">Current Session</span>
                          ) : (role === "client_admin" && profile.role !== "analyst") ? (
                            <span className="text-[12px] text-on-surface-variant italic font-medium block text-center">—</span>
                          ) : (
                            <div className="flex items-center justify-center gap-xs">
                              <button
                                onClick={() => handleOpenResetModal(profile.id, profile.email)}
                                className="flex items-center gap-xs px-3 py-1.5 bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 rounded-lg text-xs font-semibold cursor-pointer transition-all active:scale-95 !shadow-none"
                              >
                                <span className="material-symbols-outlined text-[16px]">key</span>
                                Reset Password
                              </button>
                              <button
                                onClick={() => handleDeleteUser(profile.id)}
                                className="flex items-center gap-xs px-3 py-1.5 bg-error/15 border border-error/30 text-error hover:bg-error/25 rounded-lg text-xs font-semibold cursor-pointer transition-all active:scale-95 !shadow-none"
                              >
                                <span className="material-symbols-outlined text-[16px]">delete</span>
                                Remove
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}



        {showAddUserModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="glass-panel max-w-[448px] w-full p-gutter rounded-3xl border border-outline-variant/20 flex flex-col gap-md shadow-2xl relative animate-fade-in bg-[#131b2e]">
              <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface">Add New User</h3>
              <p className="text-body-md text-on-surface-variant">
                Create a new login user for this workspace.
              </p>
              {modalError && (
                <p className="text-label-sm text-error bg-error/15 border border-error/25 p-2 rounded-lg">
                  {modalError}
                </p>
              )}
              <div className="flex flex-col gap-sm">
                <div className="flex flex-col gap-xs">
                  <label className="text-label-sm text-on-surface-variant font-bold">Email Address</label>
                  <input
                    type="email"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    placeholder="analyst@company.com"
                    className="px-4 py-2 bg-surface-container border border-outline-variant/30 rounded-lg text-on-surface focus:ring-1 focus:ring-primary outline-none text-sm"
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <div className="flex justify-between items-center">
                    <label className="text-label-sm text-on-surface-variant font-bold">Password</label>
                    <button
                      type="button"
                      onClick={handleGeneratePassword}
                      className="text-[11px] text-primary hover:text-primary-container transition-colors !shadow-none font-bold cursor-pointer"
                    >
                      Generate Password
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showModalPassword ? "text" : "password"}
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                      placeholder="Min 6 characters"
                      className="w-full px-4 py-2 pr-10 bg-surface-container border border-outline-variant/30 rounded-lg text-on-surface focus:ring-1 focus:ring-primary outline-none text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowModalPassword((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50 hover:text-on-surface-variant transition-colors cursor-pointer"
                      tabIndex={-1}
                      aria-label={showModalPassword ? "Hide password" : "Show password"}
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        {showModalPassword ? "visibility_off" : "visibility"}
                      </span>
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-xs">
                  <label className="text-label-sm text-on-surface-variant font-bold">Role</label>
                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value as "analyst" | "client_admin")}
                    className="px-4 py-2 bg-surface-container border border-outline-variant/30 rounded-lg text-on-surface focus:ring-1 focus:ring-primary outline-none text-sm appearance-none cursor-pointer"
                  >
                    <option value="analyst">Analyst</option>
                    {role === "admin" && <option value="client_admin">Client Admin</option>}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-sm mt-md">
                <button
                  onClick={() => {
                    setShowAddUserModal(false);
                    setNewUserEmail("");
                    setNewUserPassword("");
                    setNewUserRole("analyst");
                    setModalError(null);
                  }}
                  className="px-4 py-2 bg-surface-container hover:bg-surface-container-high text-on-surface border border-outline-variant/20 rounded-xl text-label-md font-bold transition-all cursor-pointer"
                  disabled={creatingUser}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateUser}
                  className="px-6 py-2 bg-primary text-on-primary hover:bg-primary/95 rounded-xl text-label-md font-bold transition-all cursor-pointer !shadow-none disabled:opacity-50"
                  disabled={creatingUser || !newUserEmail || !newUserPassword}
                >
                  {creatingUser ? "Creating..." : "Create"}
                </button>
              </div>
            </div>
          </div>
        )}

        {showContextModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
            <div className="glass-panel max-w-[500px] w-full p-gutter rounded-3xl border border-outline-variant/20 flex flex-col gap-md shadow-2xl relative bg-[#131b2e]">
              <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface flex items-center gap-xs">
                <span className="material-symbols-outlined text-primary text-[24px]">edit_note</span>
                Edit Survey Context
              </h3>

              <div className="text-body-md text-on-surface-variant">
                Context for: <strong className="text-on-surface">{contextSurveyFilename}</strong>
              </div>

              <p className="text-label-sm text-on-surface-variant/80 leading-relaxed">
                Provide custom instructions, domain rules, or brand context for this survey. This text is fed to the search query generator and the AI insights generator.
              </p>

              {contextError && (
                <p className="text-label-sm text-error bg-error/15 border border-error/25 p-2 rounded-lg">
                  {contextError}
                </p>
              )}

              <div className="flex flex-col gap-xs">
                <label className="text-label-sm text-on-surface-variant font-bold flex justify-between">
                  <span>Context / Instructions</span>
                  {loadingContext && <span className="text-primary animate-pulse font-normal">Loading...</span>}
                </label>
                <textarea
                  value={contextValue}
                  onChange={(e) => setContextValue(e.target.value)}
                  placeholder="e.g. Focus on competitor launches in Indian fintech space. The target audience is urban youth aged 18-25."
                  className="w-full h-32 px-4 py-3 bg-surface-container border border-outline-variant/30 rounded-lg text-on-surface focus:ring-1 focus:ring-primary outline-none text-sm resize-none placeholder:text-on-surface-variant/40"
                  disabled={loadingContext || savingContext}
                />
              </div>

              <div className="flex justify-end gap-sm mt-md">
                <button
                  onClick={() => {
                    setShowContextModal(false);
                    setContextSurveyId(null);
                    setContextError(null);
                  }}
                  className="px-4 py-2 bg-surface-container hover:bg-surface-container-high text-on-surface border border-outline-variant/20 rounded-xl text-label-md font-bold transition-all cursor-pointer"
                  disabled={savingContext}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveContext}
                  className="px-6 py-2 bg-primary text-on-primary hover:bg-primary/95 rounded-xl text-label-md font-bold transition-all cursor-pointer shadow-lg disabled:opacity-50 flex items-center gap-xs"
                  disabled={loadingContext || savingContext}
                >
                  {savingContext ? (
                    <>
                      <span className="w-4 h-4 border-2 border-on-primary/20 border-t-on-primary rounded-full animate-spin"></span>
                      Saving...
                    </>
                  ) : (
                    "Save Context"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Reset Password Modal */}
        {showResetModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="glass-panel max-w-[448px] w-full p-gutter rounded-3xl border border-outline-variant/20 flex flex-col gap-md shadow-2xl relative animate-fade-in bg-[#131b2e]">
              <button
                onClick={() => {
                  setShowResetModal(false);
                  setResetUserId(null);
                }}
                className="absolute right-4 top-4 text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
                disabled={resetting}
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>

              <h3 className="text-title-lg font-bold text-on-surface flex items-center gap-xs">
                <span className="material-symbols-outlined text-primary text-[24px]">key</span>
                Reset User Password
              </h3>

              {!resetSuccess ? (
                <>
                  <div className="text-body-md text-on-surface-variant">
                    Resetting password for: <strong className="text-on-surface">{resetUserEmail}</strong>
                  </div>

                  <p className="text-label-sm text-on-surface-variant/80 leading-relaxed">
                    This will overwrite the user&apos;s password with a new temporary password. The admin must copy and share this password with the user.
                  </p>

                  {resetError && (
                    <p className="text-label-sm text-error bg-error/15 border border-error/25 p-2 rounded-lg">
                      {resetError}
                    </p>
                  )}

                  <div className="flex flex-col gap-xs">
                    <div className="flex justify-between items-center">
                      <label className="text-label-sm text-on-surface-variant font-bold">New Password</label>
                      <button
                        type="button"
                        onClick={handleGenerateResetPassword}
                        className="text-[11px] text-primary hover:text-primary-container transition-colors font-bold cursor-pointer !shadow-none"
                      >
                        Generate Password
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showResetPassword ? "text" : "password"}
                        value={resetPasswordVal}
                        onChange={(e) => setResetPasswordVal(e.target.value)}
                        placeholder="Min 6 characters"
                        className="w-full px-4 py-2 pr-10 bg-surface-container border border-outline-variant/30 rounded-lg text-on-surface focus:ring-1 focus:ring-primary outline-none text-sm"
                        disabled={resetting}
                      />
                      <button
                        type="button"
                        onClick={() => setShowResetPassword((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50 hover:text-on-surface-variant transition-colors cursor-pointer !shadow-none"
                        tabIndex={-1}
                        aria-label={showResetPassword ? "Hide password" : "Show password"}
                      >
                        <span className="material-symbols-outlined text-[20px]">
                          {showResetPassword ? "visibility_off" : "visibility"}
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="flex justify-end gap-sm mt-md">
                    <button
                      onClick={() => {
                        setShowResetModal(false);
                        setResetUserId(null);
                      }}
                      className="px-4 py-2 bg-surface-container hover:bg-surface-container-high text-on-surface border border-outline-variant/20 rounded-xl text-label-md font-bold transition-all cursor-pointer"
                      disabled={resetting}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleResetPasswordSubmit}
                      className="px-6 py-2 bg-primary text-on-primary hover:bg-primary/95 rounded-xl text-label-md font-bold transition-all cursor-pointer shadow-lg disabled:opacity-50 flex items-center gap-xs"
                      disabled={resetting || !resetPasswordVal}
                    >
                      {resetting ? (
                        <>
                          <span className="w-4 h-4 border-2 border-on-primary/20 border-t-on-primary rounded-full animate-spin"></span>
                          Resetting...
                        </>
                      ) : (
                        "Update Password"
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col items-center gap-sm text-center py-sm">
                    <span className="material-symbols-outlined text-green-500 text-[48px] animate-bounce">check_circle</span>
                    <div className="text-title-md font-bold text-on-surface">Password Updated Successfully</div>
                    <p className="text-body-sm text-on-surface-variant max-w-xxl">
                      Provide the temporary password below to <strong>{resetUserEmail}</strong>. For security, it will not be shown again.
                    </p>
                  </div>

                  <div className="p-md bg-surface-container rounded-xl flex items-center justify-between border border-outline-variant/20">
                    <code className="text-sm font-bold text-on-surface select-all">{resetPasswordVal}</code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(resetPasswordVal);
                        alerts.showAlert({ title: "Success", message: "Password copied to clipboard." });
                      }}
                      className="flex items-center gap-xs text-[12px] text-primary hover:text-primary-container font-bold cursor-pointer transition-colors !shadow-none"
                    >
                      <span className="material-symbols-outlined text-[16px]">content_copy</span>
                      Copy
                    </button>
                  </div>

                  <div className="flex justify-center mt-md">
                    <button
                      onClick={() => {
                        setShowResetModal(false);
                        setResetUserId(null);
                      }}
                      className="px-8 py-2 bg-primary text-on-primary hover:bg-primary/95 rounded-xl text-label-md font-bold transition-all cursor-pointer shadow-lg"
                    >
                      Done
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

      </section>

      {/* Atmospheric BG effect */}
      <div className="fixed inset-0 pointer-events-none z-[-1] overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-primary/5 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-secondary/5 blur-[120px] rounded-full"></div>
      </div>
    </div>
  );
}
