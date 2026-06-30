"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { listSystemAdmins, createUser, deleteUser, resetUserPassword } from "@/lib/flask-api";
import { signOut } from "@/actions/auth";
import { useAlerts } from "@/components/alerts-provider";
import Link from "next/link";

interface AdminUser {
  id: string;
  email: string;
  role: string;
  created_at: string;
}

export default function AdminsManagementPage() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [newAdminRole, setNewAdminRole] = useState<"admin" | "super_admin">("admin");
  const [showModalPassword, setShowModalPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createAdminSuccess, setCreateAdminSuccess] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  
  const [searchTerm, setSearchTerm] = useState("");
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [deletingAdminId, setDeletingAdminId] = useState<string | null>(null);
  
  // Password Reset states
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetUserEmail, setResetUserEmail] = useState("");
  const [resetPasswordVal, setResetPasswordVal] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const userMenuRef = useRef<HTMLDivElement>(null);
  const alerts = useAlerts();

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

  useEffect(() => {
    loadAdmins();
  }, []);

  // Fetch token and load admins
  async function loadAdmins() {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const data = await listSystemAdmins(session.access_token);
      setAdmins(data || []);
    } catch (err) {
      console.error("Failed to load admins:", err);
    } finally {
      setLoading(false);
    }
  }

  // Get current session user ID and role
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useEffect(() => {
    async function fetchSession() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setCurrentUserId(session.user.id);
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", session.user.id)
          .single();
        if (profile) {
          setCurrentUserRole(profile.role);
        }
      }
    }
    fetchSession();
  }, []);

  const handleGeneratePassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$";
    const array = new Uint32Array(12);
    crypto.getRandomValues(array);
    let generated = "";
    for (let i = 0; i < 12; i++) {
      generated += chars.charAt(array[i] % chars.length);
    }
    setNewAdminPassword(generated);
    setShowModalPassword(true);
  };

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

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminEmail || !newAdminPassword) {
      setCreateError("Email and password are required.");
      return;
    }
    if (newAdminPassword.length < 6) {
      setCreateError("Password must be at least 6 characters long.");
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No active session");

      const user = await createUser(session.access_token, {
        email: newAdminEmail,
        password: newAdminPassword,
        role: newAdminRole,
      });

      const newAdminRecord: AdminUser = {
        id: user.id,
        email: newAdminEmail,
        role: user.role,
        created_at: user.created_at,
      };

      setAdmins((prev) => [newAdminRecord, ...prev]);
      setCreateAdminSuccess(true);

      alerts.showAlert({
        title: "Success",
        message: `${newAdminRole === "super_admin" ? "Super Admin" : "System Admin"} '${newAdminEmail}' created successfully.`,
        isDestructive: false,
      });
    } catch (err: any) {
      console.error("Error creating admin:", err);
      setCreateError(err.message || "Failed to create system admin.");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteAdmin = (adminId: string, email: string) => {
    if (adminId === currentUserId) {
      alerts.showAlert({
        title: "Action Denied",
        message: "You cannot remove your own admin account.",
        isDestructive: false,
      });
      return;
    }

    alerts.showConfirm({
      title: "Remove System Admin",
      message: `Are you sure you want to permanently delete admin "${email}"? This will revoke their system access immediately.`,
      confirmLabel: "Delete Admin",
      isDestructive: true,
      onConfirm: async () => {
        setDeletingAdminId(adminId);
        try {
          const supabase = createClient();
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) throw new Error("No active session");

          await deleteUser(session.access_token, adminId);
          // Wait briefly to show the pulsing animation clearly
          await new Promise((resolve) => setTimeout(resolve, 800));
          setAdmins((prev) => prev.filter((a) => a.id !== adminId));
          
          alerts.showAlert({
            title: "Success",
            message: `Admin '${email}' removed successfully.`,
            isDestructive: false,
          });
        } catch (err: any) {
          console.error("Error deleting admin:", err);
          alerts.showAlert({
            title: "Error Deleting Admin",
            message: err.message || "Failed to delete system admin.",
            isDestructive: true,
          });
        } finally {
          setDeletingAdminId(null);
        }
      },
    });
  };

  const handleOpenResetModal = (targetUserId: string, targetEmail: string) => {
    setResetUserId(targetUserId);
    setResetUserEmail(targetEmail);
    setResetPasswordVal("");
    setShowResetPassword(false);
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
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No active session");

      await resetUserPassword(session.access_token, resetUserId, resetPasswordVal);
      setShowResetModal(false);
      alerts.showAlert({
        title: "Success",
        message: `Password for admin ${resetUserEmail} has been updated.`,
        isDestructive: false,
      });
    } catch (err: any) {
      setResetError(err.error || err.message || "Failed to reset password.");
    } finally {
      setResetting(false);
    }
  };

  // Filter admins
  const filteredAdmins = admins.filter((admin) => {
    return admin.email.toLowerCase().includes(searchTerm.toLowerCase());
  });

  return (
    <div className="relative min-h-screen">
      {/* TopAppBar */}
      <header className="fixed top-0 right-0 w-[calc(100%-300px)] h-16 bg-surface-dim/80 backdrop-blur-md border-b border-outline-variant/10 z-40 flex items-center justify-between px-gutter">
        <div className="flex items-center gap-4">
          <Link
            href="/admin"
            className="font-headline-md text-headline-md font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary hover:opacity-90 transition-opacity cursor-pointer"
          >
            PValue Analytics
          </Link>
          <span className="text-outline-variant/60 text-headline-md font-light">/</span>
          <h2 className="font-headline-md text-headline-md font-medium text-on-surface">
            Manage Admins
          </h2>
        </div>

        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu((v) => !v)}
            className="flex items-center gap-xs bg-surface-container-high/40 hover:bg-surface-container-highest/60 rounded-full py-1.5 px-3 border border-outline-variant/10 transition-colors cursor-pointer"
            id="user-menu-btn"
          >
            <span className="material-symbols-outlined text-[18px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
              admin_panel_settings
            </span>
            <span className="text-label-sm font-bold text-on-surface-variant">
              {currentUserRole === "super_admin" ? "Super Admin" : "System Admin"}
            </span>
            <span
              className="material-symbols-outlined text-[16px] text-on-surface-variant transition-transform duration-200"
              style={{ transform: showUserMenu ? "rotate(180deg)" : "rotate(0deg)" }}
            >
              expand_more
            </span>
          </button>

          {showUserMenu && (
            <div className="absolute right-0 top-full mt-2 w-44 bg-surface-container-low border border-outline-variant/20 rounded-xl shadow-2xl overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-outline-variant/10">
                <p className="text-[11px] text-on-surface-variant uppercase tracking-widest font-bold">Signed in as</p>
                <p className="text-label-sm font-bold text-on-surface mt-0.5">
                  {currentUserRole === "super_admin" ? "Super Admin" : "System Admin"}
                </p>
              </div>
              <form action={signOut}>
                <button
                  type="submit"
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-label-sm text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors cursor-pointer"
                  id="admin-sign-out-btn"
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
      <div className="max-w-container-max mx-auto p-lg pt-24">
        {/* Page Header */}
        <div className="flex justify-between items-end mb-lg">
          <div>
            <h2 className="font-headline-lg text-headline-lg text-on-surface mb-xs">
              Manage Admins
            </h2>
            <p className="text-on-surface-variant font-body-md">
              Manage platform-level Super Admins and System Admins who configure tenants and settings.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-label-md flex items-center gap-2 shadow-lg shadow-indigo-500/20 active:scale-95 transition-all cursor-pointer !shadow-none"
            id="create-admin-btn"
          >
            <span className="material-symbols-outlined">add</span>
            Create Admin
          </button>
        </div>

        {/* Create Admin Modal Overlay */}
        {showCreate && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="glass-panel rim-light w-full max-w-[480px] p-6 rounded-2xl relative shadow-2xl flex flex-col gap-4 bg-[#131b2e]">
              {!createAdminSuccess ? (
                <>
                  <button
                    onClick={() => {
                      setShowCreate(false);
                      setNewAdminEmail("");
                      setNewAdminPassword("");
                      setShowModalPassword(false);
                      setCreateError(null);
                      setCreateAdminSuccess(false);
                      setNewAdminRole("admin");
                    }}
                    className="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface text-headline-md cursor-pointer bg-transparent border-0 !shadow-none"
                  >
                    ✕
                  </button>
                  <h3 className="font-headline-md text-headline-md font-bold mb-2 text-primary">
                    New Admin Account
                  </h3>
                  <form onSubmit={handleCreateAdmin} className="space-y-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-label-sm text-on-surface-variant">
                        Email Address
                      </label>
                      <input
                        value={newAdminEmail}
                        onChange={(e) => setNewAdminEmail(e.target.value)}
                        type="email"
                        required
                        className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-lg text-on-surface py-2 px-3 focus:ring-1 focus:ring-primary outline-none text-label-md"
                        placeholder="admin@pvalue.com"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between items-center">
                        <label className="text-label-sm text-on-surface-variant">Password</label>
                        <button
                          type="button"
                          onClick={handleGeneratePassword}
                          className="text-[11px] text-primary hover:text-primary-container transition-colors !shadow-none font-bold cursor-pointer bg-transparent border-0"
                        >
                          Generate Password
                        </button>
                      </div>
                      <div className="relative">
                        <input
                          type={showModalPassword ? "text" : "password"}
                          value={newAdminPassword}
                          onChange={(e) => setNewAdminPassword(e.target.value)}
                          required
                          className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-lg text-on-surface py-2 px-3 focus:ring-1 focus:ring-primary outline-none text-label-md pr-10"
                          placeholder="Min 6 characters"
                        />
                        <button
                          type="button"
                          onClick={() => setShowModalPassword((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50 hover:text-on-surface-variant transition-colors cursor-pointer !shadow-none bg-transparent border-0"
                          tabIndex={-1}
                        >
                          <span className="material-symbols-outlined text-[20px]">
                            {showModalPassword ? "visibility_off" : "visibility"}
                          </span>
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-label-sm text-on-surface-variant">
                        Admin Role
                      </label>
                      <select
                        value={newAdminRole}
                        onChange={(e) => setNewAdminRole(e.target.value as "admin" | "super_admin")}
                        className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-lg text-on-surface py-2 px-3 focus:ring-1 focus:ring-primary outline-none text-label-md appearance-none cursor-pointer"
                      >
                        <option value="admin">System Admin</option>
                        <option value="super_admin">Super Admin</option>
                      </select>
                    </div>

                    {createError && (
                      <p className="text-error text-label-sm">{createError}</p>
                    )}
                    <div className="flex justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreate(false);
                          setNewAdminEmail("");
                          setNewAdminPassword("");
                          setShowModalPassword(false);
                          setCreateError(null);
                          setCreateAdminSuccess(false);
                          setNewAdminRole("admin");
                        }}
                        className="px-4 py-2 rounded-lg bg-surface-container border border-outline-variant/20 hover:bg-white/5 text-label-md cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={creating}
                        className="px-6 py-2 rounded-lg bg-primary text-on-primary font-bold hover:opacity-90 active:scale-95 transition-all cursor-pointer !shadow-none"
                      >
                        {creating ? "Creating..." : "Create"}
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <>
                  <div className="flex flex-col items-center gap-sm text-center py-sm animate-fade-in">
                    <span className="material-symbols-outlined text-green-500 text-[48px] animate-bounce">check_circle</span>
                    <div className="text-title-md font-bold text-on-surface">Admin Created Successfully</div>
                    <p className="text-body-sm text-on-surface-variant max-w-xxl">
                      Provide the login details below to <strong>{newAdminEmail}</strong>. For security, the password will not be shown again.
                    </p>
                  </div>

                  <div className="p-md bg-surface-container rounded-xl flex items-center justify-between border border-outline-variant/20 mt-4">
                    <code className="text-sm font-bold text-on-surface select-all">{newAdminPassword}</code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(newAdminPassword);
                        alerts.showAlert({ title: "Success", message: "Password copied to clipboard." });
                      }}
                      className="flex items-center gap-xs text-[12px] text-primary hover:text-primary-container font-bold cursor-pointer transition-colors !shadow-none bg-transparent border-0"
                    >
                      <span className="material-symbols-outlined text-[16px]">content_copy</span>
                      Copy
                    </button>
                  </div>

                  <div className="flex justify-center mt-md pt-4">
                    <button
                      onClick={() => {
                        setShowCreate(false);
                        setNewAdminEmail("");
                        setNewAdminPassword("");
                        setShowModalPassword(false);
                        setCreateError(null);
                        setCreateAdminSuccess(false);
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

        {/* Reset Password Modal */}
        {showResetModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
            <div className="glass-panel max-w-[448px] w-full p-gutter rounded-3xl border border-outline-variant/20 flex flex-col gap-md shadow-2xl relative bg-[#131b2e] p-6">
              <button
                onClick={() => setShowResetModal(false)}
                className="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface text-headline-md cursor-pointer bg-transparent border-0 !shadow-none"
              >
                ✕
              </button>
              <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface">Reset Admin Password</h3>
              <p className="text-body-md text-on-surface-variant">
                Resetting password for: <strong className="text-on-surface">{resetUserEmail}</strong>
              </p>

              {resetError && (
                <p className="text-label-sm text-error bg-error/15 border border-error/25 p-2 rounded-lg">
                  {resetError}
                </p>
              )}

              <div className="flex flex-col gap-xs space-y-2 mt-2">
                <div className="flex justify-between items-center">
                  <label className="text-label-sm text-on-surface-variant font-bold">New Password</label>
                  <button
                    type="button"
                    onClick={handleGenerateResetPassword}
                    className="text-[11px] text-primary hover:text-primary-container transition-colors !shadow-none font-bold cursor-pointer"
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
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50 hover:text-on-surface-variant transition-colors cursor-pointer !shadow-none bg-transparent border-0"
                    tabIndex={-1}
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {showResetPassword ? "visibility_off" : "visibility"}
                    </span>
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-sm mt-md pt-4">
                <button
                  onClick={() => setShowResetModal(false)}
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
                  {resetting ? "Resetting..." : "Reset Password"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Filters & Stats Row */}
        <div className="grid grid-cols-12 gap-md mb-md">
          <div className="col-span-12 lg:col-span-8 glass-panel rim-light rounded-xl p-md flex items-center justify-between">
            <div className="flex items-center gap-md flex-1">
              <div className="relative w-full max-w-[384px]">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-on-surface-variant">
                  <span className="material-symbols-outlined">filter_alt</span>
                </span>
                <input
                  className="bg-surface-container-lowest border border-outline-variant/20 rounded-lg pl-10 pr-4 py-2 w-full focus:ring-1 focus:ring-primary/30 outline-none text-label-md"
                  placeholder="Filter admins by email..."
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="col-span-12 lg:col-span-4 glass-panel rim-light rounded-xl p-md flex items-center justify-around">
            <div className="text-center">
              <div className="text-on-surface-variant font-label-sm uppercase tracking-wider mb-1">
                Total Admins
              </div>
              <div className="text-headline-md font-bold text-primary">
                {admins.length}
              </div>
            </div>
          </div>
        </div>

        {/* Admins Table */}
        <div className="glass-panel rim-light rounded-xl overflow-hidden shadow-2xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/5 border-b border-outline-variant/20">
                <th className="px-md py-4 font-label-md text-on-surface-variant">
                  Email
                </th>
                <th className="px-md py-4 font-label-md text-on-surface-variant">
                  System Role
                </th>
                <th className="px-md py-4 font-label-md text-on-surface-variant">
                  Created Date
                </th>
                <th className="px-md py-4 font-label-md text-on-surface-variant text-center">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {loading ? (
                Array.from({ length: 3 }).map((_, idx) => (
                  <tr key={idx} className="animate-pulse">
                    <td className="px-md py-5">
                      <div className="h-4 bg-white/15 rounded w-1/3"></div>
                    </td>
                    <td className="px-md py-5">
                      <div className="h-6 bg-white/10 rounded-full w-16"></div>
                    </td>
                    <td className="px-md py-5">
                      <div className="h-4 bg-white/10 rounded w-24"></div>
                    </td>
                    <td className="px-md py-5 text-center">
                      <div className="h-8 w-16 bg-white/10 rounded-lg inline-block"></div>
                    </td>
                  </tr>
                ))
              ) : filteredAdmins.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-md py-8 text-center text-on-surface-variant">
                    No matching system admins found.
                  </td>
                </tr>
              ) : (
                filteredAdmins.map((admin) => {
                  const isDeleting = deletingAdminId === admin.id;
                  return (
                    <tr
                      key={admin.id}
                      className={`transition-colors ${
                        isDeleting
                          ? "animate-pulse bg-red-500/10 text-red-300 opacity-60 pointer-events-none"
                          : "hover:bg-white/5"
                      }`}
                    >
                      <td className="px-md py-5 text-on-surface text-label-md font-medium">
                        {admin.email}
                      </td>
                      <td className="px-md py-5">
                        {admin.role === "super_admin" ? (
                          <span className="px-3 py-1 rounded-full text-[12px] font-bold uppercase tracking-tight bg-indigo-500/20 text-indigo-400">
                            Super Admin
                          </span>
                        ) : (
                          <span className="px-3 py-1 rounded-full text-[12px] font-bold uppercase tracking-tight bg-primary/20 text-primary">
                            System Admin
                          </span>
                        )}
                      </td>
                      <td className="px-md py-5 text-on-surface-variant font-label-md">
                        {new Date(admin.created_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-md py-5 text-center">
                        {admin.id === currentUserId ? (
                          <span className="text-[12px] text-on-surface-variant italic font-medium block text-center">Current Session</span>
                        ) : (
                          <div className="flex items-center justify-center gap-xs">
                            <button
                              onClick={() => handleOpenResetModal(admin.id, admin.email)}
                              className="flex items-center gap-xs px-3 py-1.5 bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 rounded-lg text-xs font-semibold cursor-pointer transition-all active:scale-95 !shadow-none"
                            >
                              <span className="material-symbols-outlined text-[16px]">key</span>
                              Reset Password
                            </button>
                            <button
                              onClick={() => handleDeleteAdmin(admin.id, admin.email)}
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
      </div>

      {/* Background Atmospheric Effect */}
      <div className="fixed inset-0 pointer-events-none z-[-1] overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-primary/5 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-secondary/5 blur-[120px] rounded-full"></div>
      </div>
    </div>
  );
}
