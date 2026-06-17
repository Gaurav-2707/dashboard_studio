"use client";

import React, { createContext, useContext, useState, useCallback } from "react";

export interface AlertItem {
  id: string;
  title: string;
  message: string;
  type: "alert" | "confirm";
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface AlertsContextType {
  showAlert: (options: {
    title: string;
    message: string;
    isDestructive?: boolean;
    onConfirm?: () => void;
  }) => void;
  showConfirm: (options: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    isDestructive?: boolean;
    onConfirm: () => void;
    onCancel?: () => void;
  }) => void;
}

const AlertsContext = createContext<AlertsContextType | undefined>(undefined);

export function AlertsProvider({ children }: { children: React.ReactNode }) {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  const showAlert = useCallback(
    ({
      title,
      message,
      isDestructive = false,
      onConfirm,
    }: {
      title: string;
      message: string;
      isDestructive?: boolean;
      onConfirm?: () => void;
    }) => {
      const id = Math.random().toString(36).substring(2, 9);
      setAlerts((prev) => [
        ...prev,
        {
          id,
          title,
          message,
          type: "alert",
          isDestructive,
          onConfirm,
        },
      ]);
    },
    []
  );

  const showConfirm = useCallback(
    ({
      title,
      message,
      confirmLabel = "Confirm",
      cancelLabel = "Cancel",
      isDestructive = false,
      onConfirm,
      onCancel,
    }: {
      title: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
      isDestructive?: boolean;
      onConfirm: () => void;
      onCancel?: () => void;
    }) => {
      const id = Math.random().toString(36).substring(2, 9);
      setAlerts((prev) => [
        ...prev,
        {
          id,
          title,
          message,
          type: "confirm",
          confirmLabel,
          cancelLabel,
          isDestructive,
          onConfirm,
          onCancel,
        },
      ]);
    },
    []
  );

  const removeAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((alert) => alert.id !== id));
  }, []);

  return (
    <AlertsContext.Provider value={{ showAlert, showConfirm }}>
      {children}

      {/* Floating Alert Stack Container */}
      <div className="fixed top-20 right-6 z-[100] w-full max-w-[380px] flex flex-col gap-3 pointer-events-none">
        {alerts.map((alert) => {
          const handleConfirmAction = () => {
            if (alert.onConfirm) alert.onConfirm();
            removeAlert(alert.id);
          };

          const handleCancelAction = () => {
            if (alert.onCancel) alert.onCancel();
            removeAlert(alert.id);
          };

          return (
            <div
              key={alert.id}
              className="glass-panel w-full p-5 rounded-2xl border border-outline-variant/30 flex flex-col gap-3 shadow-2xl pointer-events-auto bg-[#131b2e]/95 backdrop-blur-md transition-all duration-300 transform translate-x-0 animate-fade-in"
              style={{
                animation: "slideIn 0.3s ease-out forwards",
              }}
            >
              {/* Animation styles */}
              <style>{`
                @keyframes slideIn {
                  from {
                    opacity: 0;
                    transform: translateX(100px) scale(0.9);
                  }
                  to {
                    opacity: 1;
                    transform: translateX(0) scale(1);
                  }
                }
              `}</style>

              {/* Title & Icon Header */}
              <div className="flex items-start gap-3">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                    alert.isDestructive
                      ? "bg-error/15 text-error border border-error/30"
                      : "bg-primary/15 text-primary border border-primary/30"
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px]">
                    {alert.isDestructive
                      ? "warning"
                      : alert.type === "alert"
                      ? "info"
                      : "help_outline"}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-bold text-[15px] text-on-surface truncate">
                      {alert.title}
                    </h4>
                    <button
                      onClick={handleCancelAction}
                      className="text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
                      title="Dismiss"
                    >
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  </div>
                  <p className="text-body-md text-on-surface-variant mt-1 text-[13px] leading-relaxed whitespace-pre-wrap">
                    {alert.message}
                  </p>
                </div>
              </div>

              {/* Buttons Action Group */}
              <div className="flex justify-end gap-2.5 mt-1">
                {alert.type === "confirm" && (
                  <button
                    onClick={handleCancelAction}
                    className="px-3 py-1.5 bg-surface-container hover:bg-surface-container-high text-on-surface border border-outline-variant/20 rounded-lg text-xs font-bold transition-all cursor-pointer"
                  >
                    {alert.cancelLabel || "Cancel"}
                  </button>
                )}
                <button
                  onClick={handleConfirmAction}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-md ${
                    alert.isDestructive
                      ? "bg-error text-on-error hover:bg-error/95"
                      : "bg-primary text-on-primary hover:bg-primary/95"
                  }`}
                >
                  {alert.type === "confirm" ? alert.confirmLabel || "Confirm" : "OK"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </AlertsContext.Provider>
  );
}

export function useAlerts() {
  const context = useContext(AlertsContext);
  if (context === undefined) {
    throw new Error("useAlerts must be used within an AlertsProvider");
  }
  return context;
}
