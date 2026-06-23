/**
 * Dashify — Login Page
 */
"use client";

import { useState, useActionState } from "react";
import { signIn } from "@/actions/auth";

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);

  const [state, formAction, isPending] = useActionState(
    async (prevState: any, formData: FormData) => {
      const result = await signIn(formData);
      return result || null;
    },
    null
  );

  return (
    <main className="grid min-h-screen w-full grid-cols-1 md:grid-cols-2 overflow-hidden bg-background text-on-surface">
      {/* Left Panel: Brand & Shader */}
      <section className="relative hidden md:flex flex-col items-center justify-center overflow-hidden bg-surface-container-lowest">
        {/* Overlay Content */}
        <div className="relative z-10 flex flex-col items-center text-center px-16 mx-auto">
          <div className="mb-6 flex justify-center w-full">
            <h1 className="text-3xl font-extrabold tracking-tight brand-gradient text-center mx-auto">
              PValue Analytics
            </h1>
          </div>
          <p className="text-4xl md:text-5xl font-bold text-white max-w-lg leading-tight text-center mx-auto">
            Dashboard Studio
          </p>
          <div className="mt-16 h-1 w-24 bg-gradient-to-r from-primary to-primary-container rounded-full mx-auto"></div>
        </div>

        {/* Decorative Elements */}
        <div className="absolute bottom-12 left-12 h-64 w-64 rounded-full bg-primary/5 blur-[120px]"></div>
        <div className="absolute top-12 right-12 h-64 w-64 rounded-full bg-primary-container/5 blur-[120px]"></div>
      </section>

      {/* Right Panel: Login Form */}
      <section className="relative flex flex-col items-center justify-center px-4 sm:px-6 md:px-16 bg-surface-dim">
        {/* Mobile Header Only */}
        <div className="absolute top-8 left-8 md:hidden">
          <h1 className="text-2xl brand-gradient font-bold">PValue Analytics</h1>
        </div>

        <div className="w-full max-w-xxl space-y-6">
          {/* Login Card */}
          <div className="glass-panel rim-light rounded-xl p-6 sm:p-12 w-full">
            <div className="mb-6 text-center md:text-left">
              <h2 className="text-3xl text-white font-bold mb-1">Welcome Back</h2>
              <p className="text-base text-on-surface-variant">Access your analytics dashboard</p>
            </div>

            {state?.error && (
              <div className="flex items-center gap-2 p-3 bg-error/12 border border-error/25 rounded-lg text-error text-sm mb-4" role="alert">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
                  <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 4h2v5H7V4zm0 6h2v2H7v-2z" />
                </svg>
                <span>{state.error}</span>
              </div>
            )}

            <form action={formAction} className="space-y-6">
              {/* Email Input */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-on-surface-variant block" htmlFor="email">
                  Email Address
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-[20px]">
                    mail
                  </span>
                  <input
                    className="w-full h-12 rounded-lg pl-12 pr-4 text-white text-base placeholder:text-on-surface-variant/30 custom-input focus"
                    id="email"
                    name="email"
                    placeholder="name@company.com"
                    required
                    type="email"
                    autoComplete="email"
                  />
                </div>
              </div>

              {/* Password Input */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-on-surface-variant block" htmlFor="password">
                    Password
                  </label>
                </div>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-[20px]">
                    lock
                  </span>
                  <input
                    className="w-full h-12 rounded-lg pl-12 pr-12 text-white text-base placeholder:text-on-surface-variant/30 custom-input focus"
                    id="password"
                    name="password"
                    placeholder="••••••••"
                    required
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                  />
                  <button
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant/50 hover:text-on-surface transition-colors cursor-pointer no-shadow"
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {showPassword ? "visibility_off" : "visibility"}
                    </span>
                  </button>
                </div>
              </div>



              {/* Submit Button */}
              <button
                className="w-full h-12 mt-6 rounded-lg gradient-button text-white font-semibold text-sm flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
                type="submit"
                disabled={isPending}
                id="login-submit"
              >
                {isPending ? (
                  <>
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>LOGGING IN...</span>
                  </>
                ) : (
                  <>
                    <span>LOG IN</span>
                    <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Footer Security Text */}
          <div className="flex flex-col items-center space-y-1 pt-2">
            <div className="flex items-center space-x-2 opacity-60">
              <span
                className="material-symbols-outlined text-[16px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                verified_user
              </span>
              <p className="text-xs">Secured by Supabase Auth</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
