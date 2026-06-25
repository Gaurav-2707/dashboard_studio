/**
 * Dashify — Sidebar Component
 * Styled according to Google Stitch specifications.
 */
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

interface SidebarProps {
  companyId: string;
  companyName: string;
  userEmail: string;
  role: "admin" | "client_admin" | "analyst";
}

export default function Sidebar({
  companyId,
  companyName,
  userEmail,
  role,
}: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeSurveyId = searchParams.get("survey_id");
  const isSurveyMode = !!activeSurveyId;

  const navItems = [
    ...(companyId && companyId !== "null"
      ? [
        {
          label: "Dashboard",
          href: `/dashboard/${companyId}`,
          icon: "dashboard",
        },
      ]
      : []),
    ...(role === "admin"
      ? [
        {
          label: "Admin Panel",
          href: "/admin",
          icon: "admin_panel_settings",
        },
      ]
      : []),
  ];

  return (
    <aside className="h-screen w-[300px] fixed left-0 top-0 bg-surface-container/60 backdrop-blur-xl border-r border-outline-variant/10 shadow-xl flex flex-col py-md z-50">
      {/* Brand Header */}
      <div className="px-md mb-xl">
        <Link
          href={role === "admin" ? "/admin" : `/dashboard/${companyId}`}
          className="flex items-center gap-xs hover:opacity-90 transition-opacity cursor-pointer group"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-primary to-secondary flex items-center justify-center">
            <span
              className="material-symbols-outlined text-on-primary-container"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              analytics
            </span>
          </div>
          <h1 className="font-headline-md text-headline-md font-bold text-primary tracking-tight">
            PValue Analytics
          </h1>
        </Link>
        <p className="text-label-sm font-label-sm text-on-surface-variant mt-1 opacity-70">
          Dashboard Studio
        </p>
      </div>

      {/* Navigation or Chart Controls Portal */}
      {isSurveyMode ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-sm">
          {/* Portal Container */}
          <div
            id="sidebar-settings-portal"
            className="flex-1 overflow-y-auto custom-scrollbar space-y-md pr-1"
          />
        </div>
      ) : (
        <nav className="flex-1 space-y-1 px-sm overflow-y-auto custom-scrollbar">
          {navItems.map((item) => {
            const isActive =
              item.href.startsWith("/dashboard/")
                ? pathname === item.href
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-md py-3 rounded-xl transition-all duration-200 group ${isActive
                  ? "bg-primary-container/20 text-primary border-l-4 border-primary"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-white/5"
                  }`}
              >
                <span
                  className={`material-symbols-outlined ${isActive ? "" : "group-hover:text-primary"
                    }`}
                  style={isActive ? { fontVariationSettings: "'FILL' 1" } : {}}
                >
                  {item.icon}
                </span>
                <span className="font-label-md">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      )}

      {/* Bottom Profile section */}
      <div className="mt-auto border-t border-outline-variant/10 pt-md">
        {/* User profile avatar and company details */}
        <div className="px-md pb-md flex items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-primary/30 bg-surface-container-highest flex items-center justify-center text-primary font-bold text-headline-sm">
            {companyName.charAt(0).toUpperCase()}
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="text-on-surface font-label-md truncate">
              {companyName}
            </span>
            <span
              className="text-on-surface-variant text-[11px] truncate"
              title={userEmail}
            >
              {role === "admin" ? "System Admin" : role === "client_admin" ? "Client Admin" : "Analyst"}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
