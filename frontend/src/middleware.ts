/**
 * Dashify — Edge Middleware Route Guard
 *
 * Zero-trust model: DENY by default. Only whitelisted public routes are accessible
 * without authentication. All other routes require a valid session with proper claims.
 *
 * Guards:
 * 1. Auth check — unauthenticated → /login
 * 2. Admin route guard — /admin/* requires role === 'admin'
 * 3. Company ID tamper guard — URL company_id must match JWT company_id
 * 4. Unassigned user guard — users without a company are redirected
 */

import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Routes that do NOT require authentication
const PUBLIC_ROUTES = ["/login", "/api/auth/callback"];

// Static file extensions to skip
const STATIC_EXTENSIONS = /\.(ico|png|jpg|jpeg|gif|svg|webp|css|js|woff2?|ttf|map)$/;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- Skip static assets ---
  if (STATIC_EXTENSIONS.test(pathname) || pathname.startsWith("/_next/")) {
    return NextResponse.next();
  }

  // --- Allow public routes ---
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    // If user is already authenticated, redirect away from login
    if (pathname.startsWith("/login")) {
      const { user } = await updateSession(request);
      if (user) {
        // Get company_id from user metadata or JWT
        const session = await getSessionClaims(request);
        if (session?.role === "admin" || session?.role === "super_admin") {
          return NextResponse.redirect(new URL("/admin", request.url));
        } else if (session?.company_id) {
          return NextResponse.redirect(
            new URL(`/dashboard/${session.company_id}`, request.url)
          );
        }
      }
    }
    return NextResponse.next();
  }

  // --- Authenticate ---
  const { user, supabaseResponse } = await updateSession(request);

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // --- Extract JWT claims ---
  const claims = await getSessionClaims(request);
  console.log("[MIDDLEWARE DECODED CLAIMS]:", JSON.stringify(claims));
  const companyId = claims?.company_id;
  const role = claims?.role;
  const companyStatus = claims?.company_status;

  // --- Guard: Unassigned users ---
  if ((!companyId || companyId === "null" || role === "unassigned") && role !== "admin" && role !== "super_admin") {
    // User exists but isn't assigned to a company yet
    if (!pathname.startsWith("/pending")) {
      return NextResponse.redirect(new URL("/pending", request.url));
    }
    return supabaseResponse;
  }

  // --- Guard: Company in pending_deletion ---
  if (companyStatus === "pending_deletion" && !pathname.startsWith("/admin")) {
    // Allow admins to access admin panel to cancel deletion
    if (role !== "admin" && role !== "super_admin") {
      return NextResponse.redirect(new URL("/suspended", request.url));
    }
  }

  // --- Guard: Admin routes ---
  if (pathname.startsWith("/admin")) {
    if (role !== "admin" && role !== "super_admin") {
      return NextResponse.redirect(
        new URL(`/dashboard/${companyId}`, request.url)
      );
    }
  }

  // --- Guard: Company ID tamper prevention ---
  const dashboardMatch = pathname.match(/^\/dashboard\/([^/]+)/);
  if (dashboardMatch) {
    const urlCompanyId = dashboardMatch[1];
    if (urlCompanyId !== companyId && role !== "admin" && role !== "super_admin") {
      // TAMPER DETECTED: URL company_id doesn't match JWT company_id
      console.warn(
        `[SECURITY] Company ID mismatch: URL=${urlCompanyId}, JWT=${companyId}, User=${user.id}`
      );
      return NextResponse.redirect(
        new URL(`/dashboard/${companyId}`, request.url)
      );
    }
  }

  // --- Root redirect ---
  if (pathname === "/") {
    if (role === "admin" || role === "super_admin") {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return NextResponse.redirect(
      new URL(`/dashboard/${companyId}`, request.url)
    );
  }

  return supabaseResponse;
}

/**
 * Extract custom claims from the Supabase session cookie.
 * Falls back gracefully if claims aren't available yet.
 */
async function getSessionClaims(request: NextRequest) {
  try {
    const { supabase } = await updateSession(request);
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) return null;

    // Decode JWT payload (we don't verify here — middleware already verified via getUser)
    const payload = JSON.parse(
      Buffer.from(session.access_token.split(".")[1], "base64").toString()
    );

    return {
      company_id: payload.company_id as string | null,
      role: payload.user_role as string | null,
      company_status: payload.company_status as string | null,
    };
  } catch {
    return null;
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
