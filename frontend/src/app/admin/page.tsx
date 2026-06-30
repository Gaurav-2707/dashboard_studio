/**
 * Dashify — Admin Panel Page
 * Styled with Tailwind CSS matching Google Stitch specifications.
 */
"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { createCompanyAction } from "@/actions/create-company";
import { signOut } from "@/actions/auth";
import Link from "next/link";

interface CompanyRow {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

export default function AdminPage() {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showUserMenu, setShowUserMenu] = useState(false);
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

  useEffect(() => {
    async function fetchSession() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
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
    loadCompanies();
  }, []);

  async function loadCompanies() {
    const supabase = createClient();
    const { data } = await supabase
      .from("companies")
      .select("id, name, status, created_at")
      .order("created_at", { ascending: false });

    setCompanies(data || []);
    setLoading(false);
  }

  async function handleCreate(formData: FormData) {
    setCreating(true);
    setCreateError(null);

    const result = await createCompanyAction(formData);
    if (result.success) {
      setShowCreate(false);
      loadCompanies();
    } else {
      setCreateError(result.error || "Failed to create company.");
    }
    setCreating(false);
  }

  // Filter companies
  const filteredCompanies = companies.filter((company) => {
    return company.name
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
  });

  // Calculate statistics
  const totalCompanies = companies.length;

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
            Admin Management
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
              Admin Management
            </h2>
            <p className="text-on-surface-variant font-body-md">
              Configure organization permissions and system-level entities.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-label-md flex items-center gap-2 shadow-lg shadow-indigo-500/20 active:scale-95 transition-all cursor-pointer"
            id="create-company-btn"
          >
            <span className="material-symbols-outlined">corporate_fare</span>
            Create Company
          </button>
        </div>

        {/* Create Company Modal Overlay */}
        {showCreate && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="glass-panel rim-light w-full max-w-[480px] p-6 rounded-2xl relative shadow-2xl flex flex-col gap-4">
              <button
                onClick={() => setShowCreate(false)}
                className="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface text-headline-md cursor-pointer"
              >
                ✕
              </button>
              <h3 className="font-headline-md text-headline-md font-bold mb-2 text-primary">
                New Company
              </h3>
              <form action={handleCreate} className="space-y-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-label-sm text-on-surface-variant">
                    Company Name
                  </label>
                  <input
                    name="company_name"
                    type="text"
                    required
                    className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-lg text-on-surface py-2 px-3 focus:ring-2 focus:ring-primary/50 outline-none text-label-md"
                    placeholder="Enter company name"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-label-sm text-on-surface-variant">
                    Industry / Sector (optional)
                  </label>
                  <input
                    name="industry"
                    type="text"
                    className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-lg text-on-surface py-2 px-3 focus:ring-2 focus:ring-primary/50 outline-none text-label-md"
                    placeholder="e.g., Automotive, FMCG, Tech"
                  />
                </div>

                {createError && (
                  <p className="text-error text-label-sm">{createError}</p>
                )}
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    className="px-4 py-2 rounded-lg bg-surface-container border border-outline-variant/20 hover:bg-white/5 text-label-md cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="px-6 py-2 rounded-lg bg-primary text-on-primary font-bold hover:opacity-90 active:scale-95 transition-all cursor-pointer"
                  >
                    {creating ? "Creating..." : "Create"}
                  </button>
                </div>
              </form>
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
                  placeholder="Filter companies by name..."
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
                Total Companies
              </div>
              <div className="text-headline-md font-bold text-primary">
                {totalCompanies}
              </div>
            </div>
          </div>
        </div>

        {/* Companies Table */}
        <div className="glass-panel rim-light rounded-xl overflow-hidden shadow-2xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/5 border-b border-outline-variant/20">
                <th className="px-md py-4 font-label-md text-on-surface-variant">
                  Name
                </th>
                <th className="px-md py-4 font-label-md text-on-surface-variant">
                  Status
                </th>
                <th className="px-md py-4 font-label-md text-on-surface-variant">
                  Created Date
                </th>
                <th className="px-md py-4 font-label-md text-on-surface-variant text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {loading ? (
                Array.from({ length: 4 }).map((_, idx) => (
                  <tr key={idx} className="animate-pulse">
                    <td className="px-md py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-white/10"></div>
                        <div className="space-y-2 flex-1">
                          <div className="h-4 bg-white/15 rounded w-1/3"></div>
                          <div className="h-3 bg-white/5 rounded w-1/4"></div>
                        </div>
                      </div>
                    </td>
                    <td className="px-md py-5">
                      <div className="h-6 bg-white/10 rounded-full w-16"></div>
                    </td>
                    <td className="px-md py-5">
                      <div className="h-4 bg-white/10 rounded w-24"></div>
                    </td>
                    <td className="px-md py-5 text-right">
                      <div className="h-8 w-8 bg-white/10 rounded-lg inline-block"></div>
                    </td>
                  </tr>
                ))
              ) : filteredCompanies.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-md py-8 text-center text-on-surface-variant">
                    No matching companies found.
                  </td>
                </tr>
              ) : (
                filteredCompanies.map((company) => (
                  <tr key={company.id} className="hover:bg-white/5 transition-colors group">
                    <td className="px-md py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold">
                          {company.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <Link
                            href={`/dashboard/${company.id}`}
                            className="text-on-surface font-label-md hover:text-primary transition-colors hover:underline"
                          >
                            {company.name}
                          </Link>
                          <div className="text-on-surface-variant text-[12px]">
                            Tenant ID: {company.id.slice(0, 8)}...
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-md py-5">
                      <span
                        className={`px-3 py-1 rounded-full text-[12px] font-bold uppercase tracking-tight ${
                          company.status === "active"
                            ? "bg-secondary/20 text-secondary"
                            : "bg-error/20 text-error"
                        }`}
                      >
                        {company.status === "active" ? "Active" : "Pending Deletion"}
                      </span>
                    </td>
                    <td className="px-md py-5 text-on-surface-variant font-label-md">
                      {new Date(company.created_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-md py-5 text-right">
                      <Link
                        href={`/admin/delete-company?id=${company.id}&name=${encodeURIComponent(company.name)}`}
                        className="p-2 text-error hover:bg-error/10 rounded-lg transition-all inline-flex items-center"
                      >
                        <span className="material-symbols-outlined text-[20px]">
                          delete
                        </span>
                      </Link>
                    </td>
                  </tr>
                ))
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
