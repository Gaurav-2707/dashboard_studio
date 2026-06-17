"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/components/sidebar";

export default function AdminLayoutClient({
  companyId,
  companyName,
  userEmail,
  children,
}: {
  companyId: string;
  companyName: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isDeletePage = pathname === "/admin/delete-company";

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0a0a0f" }}>
      {/* Hide the sidebar via CSS display: none to prevent unmounting/remounting lag */}
      <div style={{ display: isDeletePage ? "none" : "block" }}>
        <Sidebar
          companyId={companyId}
          companyName={companyName}
          userEmail={userEmail}
          role="admin"
        />
      </div>
      <main
        style={{
          flex: 1,
          padding: isDeletePage ? "0" : "2rem",
          marginLeft: isDeletePage ? "0" : "300px",
          display: isDeletePage ? "flex" : "block",
          justifyContent: isDeletePage ? "center" : "initial",
          alignItems: isDeletePage ? "center" : "initial",
          minHeight: isDeletePage ? "100vh" : "auto",
        }}
      >
        {children}
      </main>
    </div>
  );
}
