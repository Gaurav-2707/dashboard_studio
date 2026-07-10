"use client";

import React, { useState, useEffect, useRef } from "react";
import { chatWithLLMStream } from "@/lib/flask-api";

interface ChartChatAssistantProps {
  surveyId: string;
  tableId: string | null;
  tableTitle: string;
  activeColumns: string[];
  tableData: Record<string, Record<string, number | string>>;
  accessToken: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChartChatAssistant({
  surveyId,
  tableId,
  tableTitle,
  activeColumns,
  tableData,
  accessToken,
}: ChartChatAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatHistoryRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom of the chat history
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading]);

  // Reset chat history when selecting a new chart/table
  useEffect(() => {
    if (tableId) {
      setMessages([
        {
          role: "assistant",
          content: `Hello! I'm your Dashify AI assistant. How can I help you analyze the survey data for the question **"${tableTitle}"** today?`,
        },
      ]);
    } else {
      setMessages([]);
    }
    setIsOpen(false); // Close the chat window when chart changes
  }, [tableId, tableTitle]);

  if (!tableId) return null;

  const handleClearChat = () => {
    setMessages([
      {
        role: "assistant",
        content: `Hello! I'm your Dashify AI assistant. How can I help you analyze the survey data for the question **"${tableTitle}"** today?`,
      },
    ]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userQuery = input.trim();
    setInput("");
    setLoading(true);

    const updatedMessages: Message[] = [
      ...messages,
      { role: "user", content: userQuery },
    ];

    // Add user message and a placeholder empty assistant message to stream into
    setMessages([
      ...updatedMessages,
      { role: "assistant", content: "" },
    ]);

    try {
      const response = await chatWithLLMStream(accessToken, {
        survey_id: surveyId,
        table_id: tableId,
        table_title: tableTitle,
        active_columns: activeColumns,
        table_data: tableData,
        messages: updatedMessages,
      });

      if (!response.body) {
        throw new Error("Chat response body is unreadable");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let accumulatedText = "";

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value, { stream: !done });
          accumulatedText += chunk;

          setMessages((prev) => {
            const next = [...prev];
            if (next.length > 0) {
              next[next.length - 1] = {
                role: "assistant",
                content: accumulatedText,
              };
            }
            return next;
          });
        }
      }
    } catch (err: any) {
      console.error("Error reading chat stream:", err);
      setMessages((prev) => {
        const next = [...prev];
        if (next.length > 0) {
          next[next.length - 1] = {
            role: "assistant",
            content: `Failed to generate a response: ${err.message || "Please check your network connection and try again."}`,
          };
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  };

  // Helper functions for safe, custom Markdown formatting (bold, lists, etc.)
  const renderTextWithBold = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={i} className="font-bold text-primary">
            {part.slice(2, -2)}
          </strong>
        );
      }

      // Inline code fallback (`code`)
      const codeParts = part.split(/(`.*?`)/g);
      return codeParts.map((subPart, j) => {
        if (subPart.startsWith("`") && subPart.endsWith("`")) {
          return (
            <code key={j} className="bg-surface-container-highest px-1 py-0.5 rounded font-mono text-xs text-secondary-fixed">
              {subPart.slice(1, -1)}
            </code>
          );
        }
        return subPart;
      });
    });
  };

  const formatMessageContent = (content: string) => {
    const lines = content.split("\n");
    return lines.map((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        const bulletText = trimmed.substring(2);
        return (
          <li key={idx} className="ml-4 list-disc text-[13px] text-on-surface/90 my-1 leading-relaxed">
            {renderTextWithBold(bulletText)}
          </li>
        );
      }
      return (
        <p key={idx} className="text-[13px] text-on-surface/90 leading-relaxed my-1 min-h-[1em]">
          {renderTextWithBold(line)}
        </p>
      );
    });
  };

  return (
    <div className="fixed bottom-8 right-8 z-50 flex flex-col items-end gap-4 pointer-events-none">
      {/* Chat Window Container */}
      <div
        className={`w-[360px] h-[500px] glass-panel rounded-xl shadow-2xl flex flex-col overflow-hidden border border-primary/20 backdrop-blur-xl transition-all duration-300 ease-out origin-bottom-right pointer-events-auto ${isOpen
          ? "scale-100 opacity-100 translate-y-0"
          : "scale-95 opacity-0 translate-y-4 pointer-events-none"
          }`}
        id="ai-chat-window"
      >
        {/* Header */}
        <div className="p-4 bg-primary/10 border-b border-outline-variant/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary animate-pulse">borg</span>
            <span className="font-bold text-on-surface">Dashboard Assistant</span>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 1 && (
              <button
                title="Clear Chat"
                className="material-symbols-outlined text-on-surface-variant hover:text-error transition-colors text-lg cursor-pointer"
                onClick={handleClearChat}
                disabled={loading}
              >
                delete
              </button>
            )}
            <button
              className="material-symbols-outlined text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer !shadow-none"
              onClick={() => setIsOpen(false)}
            >
              close
            </button>
          </div>
        </div>

        {/* Chat History */}
        <div
          ref={chatHistoryRef}
          className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar"
        >
          {messages.map((msg, index) => {
            const isUser = msg.role === "user";
            return (
              <div
                key={index}
                className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
              >
                <div
                  className={`p-3 rounded-lg max-w-[85%] ${isUser
                    ? "bg-primary/20 border border-primary/10 rounded-tr-none text-on-surface"
                    : "bg-surface-container-highest rounded-tl-none text-on-surface"
                    }`}
                >
                  {isUser ? (
                    <p className="text-[13px] text-on-surface leading-relaxed">{msg.content}</p>
                  ) : (
                    <div className="space-y-1">
                      {msg.content === "" && loading ? (
                        <div className="flex items-center gap-1 py-1">
                          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></span>
                          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></span>
                          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></span>
                        </div>
                      ) : (
                        formatMessageContent(msg.content)
                      )}
                    </div>
                  )}
                </div>
                <span className="text-[9px] text-on-surface-variant/70 px-1">
                  {isUser ? "You" : "AI Assistant"}
                </span>
              </div>
            );
          })}
          <div ref={chatEndRef} />

          <div className="pt-2 text-center">
            <p className="text-[10px] text-on-surface-variant/50 italic">
              Chat history is not saved.
            </p>
          </div>
        </div>

        {/* Input Area */}
        <form
          onSubmit={handleSubmit}
          className="p-4 border-t border-outline-variant/20 bg-surface-container-low/50"
        >
          <div className="relative flex items-center">
            <input
              className="w-full bg-surface-container-high border-outline-variant/30 rounded-lg py-2 pl-3 pr-10 text-[14px] text-on-surface focus:ring-primary focus:border-primary focus:outline-none transition-all placeholder:text-on-surface-variant/40"
              placeholder="Ask about your data..."
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="absolute right-2 text-primary hover:scale-110 active:scale-95 transition-transform disabled:opacity-30 disabled:scale-100 cursor-pointer"
            >
              <span className="material-symbols-outlined">send</span>
            </button>
          </div>
        </form>
      </div>

      {/* Floating Action Button (FAB) */}
      <button
        className="w-14 h-14 bg-primary text-on-primary rounded-full shadow-[0_0_20px_rgba(245,158,11,0.4)] flex items-center justify-center hover:scale-110 active:scale-95 transition-all group pointer-events-auto cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="material-symbols-outlined text-[28px] group-hover:rotate-12 transition-transform">
          {isOpen ? "close" : "borg"}
        </span>
      </button>
    </div>
  );
}
