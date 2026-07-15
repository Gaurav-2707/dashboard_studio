"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { chatWithLLMStream } from "@/lib/flask-api";

function getRelevanceScore(titleA: string, titleB: string): number {
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "with", "of", "by", 
    "is", "are", "was", "were", "about", "what", "how", "why", "who", "where", "which"
  ]);
  const cleanTokens = (text: string) => {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .split(/[\s_]+/)
      .filter(w => w && w.length > 1 && !stopWords.has(w));
  };

  const tokensA = cleanTokens(titleA);
  const tokensB = cleanTokens(titleB);

  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setA = new Set(tokensA);
  let overlap = 0;
  for (const token of tokensB) {
    if (setA.has(token)) {
      overlap++;
    }
  }

  return overlap / (setA.size + new Set(tokensB).size - overlap);
}

function getTopSuggestions(
  activeTitle: string,
  allOtherTables: Array<{ id: string; title: string }>
): Array<{ id: string; title: string }> {
  const scored = allOtherTables.map((t) => ({
    table: t,
    score: getRelevanceScore(activeTitle, t.title),
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const aNum = parseInt(a.table.id, 10);
    const bNum = parseInt(b.table.id, 10);
    if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
    return a.table.id.localeCompare(b.table.id);
  });

  return scored.slice(0, 10).map((s) => s.table);
}


interface ChartChatAssistantProps {
  surveyId: string;
  tableId: string | null;
  tableTitle: string;
  activeColumns: string[];
  tableData: Record<string, Record<string, number | string>>;
  accessToken: string;
  surveyData?: Record<string, { title?: string; data?: Record<string, Record<string, number | string>> }>;
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
  surveyData,
}: ChartChatAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Reference table selection state
  const [showRefSelector, setShowRefSelector] = useState(false);
  const [selectedRefTableIds, setSelectedRefTableIds] = useState<Set<string>>(new Set());
  const [refSearch, setRefSearch] = useState("");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const refSelectorRef = useRef<HTMLDivElement>(null);

  // Build list of other tables in the survey (excluding the active table)
  const otherTables = useMemo(() => {
    if (!surveyData) return [];
    return Object.entries(surveyData)
      .filter(([id]) => id !== tableId)
      .map(([id, info]) => ({
        id,
        title: info.title || `Table ${id}`,
      }))
      .sort((a, b) => {
        const aNum = parseInt(a.id, 10);
        const bNum = parseInt(b.id, 10);
        if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
        return a.id.localeCompare(b.id);
      });
  }, [surveyData, tableId]);

  // Get top 10 initial table suggestions based on active table title
  const initialSuggestions = useMemo(() => {
    return getTopSuggestions(tableTitle, otherTables);
  }, [tableTitle, otherTables]);

  // Filtered list based on search
  const filteredOtherTables = useMemo(() => {
    if (!refSearch.trim()) return otherTables;
    const q = refSearch.toLowerCase();
    return otherTables.filter(
      (t) => t.title.toLowerCase().includes(q) || t.id.includes(q)
    );
  }, [otherTables, refSearch]);

  // Close ref selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (refSelectorRef.current && !refSelectorRef.current.contains(e.target as Node)) {
        setShowRefSelector(false);
      }
    };
    if (showRefSelector) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showRefSelector]);

  // Auto-resize textarea height as text wraps
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, [input]);

  // Auto-scroll to the bottom of the chat history
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading]);

  const suggestionsKey = useMemo(() => {
    return initialSuggestions.map((t) => t.id).join(",");
  }, [initialSuggestions]);

  // Reset chat history when selecting a new chart/table
  useEffect(() => {
    if (tableId) {
      const hasSuggestions = initialSuggestions.length > 0;
      const suggestionsTag = hasSuggestions
        ? `\n\n<suggestions>${initialSuggestions.map(t => t.id).join(", ")}</suggestions>`
        : "";
      const content = hasSuggestions
        ? `Hello! I'm your AI assistant. To help support my answers with cross-referenced data, I've analyzed the survey and found the top 10 suggested tables for **"${tableTitle}"**.\n\nPlease select between 1 and 3 tables below to link:${suggestionsTag}`
        : `Hello! I'm your AI assistant. How can I help you analyze the survey data for the question **"${tableTitle}"** today?`;

      setMessages([
        {
          role: "assistant",
          content,
        },
      ]);
    } else {
      setMessages([]);
    }
    setIsOpen(false); // Close the chat window when chart changes
    setSelectedRefTableIds(new Set()); // Clear reference selections on table change
  }, [tableId, tableTitle, suggestionsKey]);

  if (!tableId) return null;

  const handleClearChat = () => {
    const hasSuggestions = initialSuggestions.length > 0;
    const suggestionsTag = hasSuggestions
      ? `\n\n<suggestions>${initialSuggestions.map(t => t.id).join(", ")}</suggestions>`
      : "";
    const content = hasSuggestions
      ? `Hello! I'm your Dashify AI assistant. To help support my answers with cross-referenced data, I've analyzed the survey and found the top 10 suggested tables for **"${tableTitle}"**.\n\nPlease select between 1 and 3 tables below to link:${suggestionsTag}`
      : `Hello! I'm your Dashify AI assistant. How can I help you analyze the survey data for the question **"${tableTitle}"** today?`;

    setMessages([
      {
        role: "assistant",
        content,
      },
    ]);
  };

  const MAX_REF_TABLES = 3;

  const toggleRefTable = (id: string) => {
    setSelectedRefTableIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_REF_TABLES) {
        next.add(id);
      }
      return next;
    });
  };

  const handleSubmit = async (e?: React.SyntheticEvent) => {
    e?.preventDefault();
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

    // Build reference_tables payload from selected IDs
    const referenceTables = surveyData
      ? Array.from(selectedRefTableIds)
        .filter((id) => surveyData[id])
        .map((id) => ({
          table_id: id,
          table_title: surveyData[id].title || `Table ${id}`,
          table_data: surveyData[id].data || {},
        }))
      : [];

    try {
      const response = await chatWithLLMStream(accessToken, {
        survey_id: surveyId,
        table_id: tableId,
        table_title: tableTitle,
        active_columns: activeColumns,
        table_data: tableData,
        messages: updatedMessages,
        reference_tables: referenceTables.length > 0 ? referenceTables : undefined,
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

  // Helper functions for safe, custom Markdown formatting (bold, lists, headings, and tables)
  const renderCodeOnly = (text: string) => {
    const codeParts = text.split(/(`.*?`)/g);
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
  };

  const renderItalicsAndCode = (text: string) => {
    const italicParts = text.split(/(\*.*?\*)/g);
    return italicParts.map((italicPart, i) => {
      if (italicPart.startsWith("*") && italicPart.endsWith("*") && !italicPart.startsWith("**")) {
        return (
          <em key={i} className="italic text-primary-fixed-dim font-medium">
            {renderCodeOnly(italicPart.slice(1, -1))}
          </em>
        );
      }
      return renderCodeOnly(italicPart);
    });
  };

  const renderTextWithBold = (text: string) => {
    const boldParts = text.split(/(\*\*.*?\*\*)/g);
    return boldParts.map((boldPart, i) => {
      if (boldPart.startsWith("**") && boldPart.endsWith("**")) {
        return (
          <strong key={i} className="font-bold text-primary">
            {renderItalicsAndCode(boldPart.slice(2, -2))}
          </strong>
        );
      }
      return renderItalicsAndCode(boldPart);
    });
  };

  const renderTableHelper = (rows: string[][], key: number) => {
    if (rows.length === 0) return null;
    const headers = rows[0];
    const dataRows = rows.slice(1);

    return (
      <div key={key} className="overflow-x-auto my-3 rounded-lg border border-outline-variant/20 bg-surface-container-low/40 custom-scrollbar">
        <table className="min-w-full divide-y divide-outline-variant/10 text-left font-sans text-xs">
          <thead>
            <tr className="bg-surface-container-high/60">
              {headers.map((h, i) => (
                <th key={i} className="px-2.5 py-2 font-bold text-primary-fixed-dim text-[11px] tracking-wider uppercase">
                  {renderTextWithBold(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/5">
            {dataRows.map((row, i) => (
              <tr key={i} className="hover:bg-white/5 transition-colors">
                {row.map((cell, j) => (
                  <td key={j} className="px-2.5 py-2 text-on-surface/90 text-[11px] leading-relaxed">
                    {renderTextWithBold(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderNormalLine = (line: string, key: number) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return <div key={key} className="h-1" />;
    }

    // Headings
    if (trimmed.startsWith("### ")) {
      return (
        <h4 key={key} className="font-bold text-sm text-primary-fixed-dim my-2 mt-3 block">
          {renderTextWithBold(trimmed.substring(4))}
        </h4>
      );
    }
    if (trimmed.startsWith("## ")) {
      return (
        <h3 key={key} className="font-bold text-base text-primary-fixed-dim my-2.5 mt-4 block">
          {renderTextWithBold(trimmed.substring(3))}
        </h3>
      );
    }
    if (trimmed.startsWith("# ")) {
      return (
        <h2 key={key} className="font-bold text-lg text-primary-fixed-dim my-3 mt-4 block">
          {renderTextWithBold(trimmed.substring(2))}
        </h2>
      );
    }

    // Lists
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const bulletText = trimmed.substring(2);
      return (
        <li key={key} className="ml-4 list-disc text-[13px] text-on-surface/90 my-0.5 leading-relaxed">
          {renderTextWithBold(bulletText)}
        </li>
      );
    }

    // Normal text
    return (
      <p key={key} className="text-[13px] text-on-surface/90 leading-relaxed my-1">
        {renderTextWithBold(line)}
      </p>
    );
  };

  const renderInteractiveSuggestions = (ids: string[], key: number) => {
    return (
      <div key={key} className="mt-4 p-3 bg-surface-container/60 rounded-lg border border-outline-variant/10 space-y-2 pointer-events-auto">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-primary-fixed-dim uppercase tracking-wider">
            Suggested Tables to Link
          </span>
          <span className="text-[10px] text-on-surface-variant/70 font-medium">
            {selectedRefTableIds.size} / 3 selected
          </span>
        </div>
        <div className="space-y-1.5 max-h-[180px] overflow-y-auto custom-scrollbar pr-1">
          {ids.map((id) => {
            const tableInfo = surveyData?.[id];
            if (!tableInfo) return null;

            const isSelected = selectedRefTableIds.has(id);
            const isDisabled = !isSelected && selectedRefTableIds.size >= 3;

            return (
              <button
                key={id}
                type="button"
                disabled={isDisabled}
                onClick={() => toggleRefTable(id)}
                className={`w-full px-2.5 py-2 rounded-md flex items-center justify-between text-left transition-all border
                  ${
                    isSelected
                      ? "bg-primary/15 border-primary text-on-surface shadow-[0_0_8px_rgba(245,158,11,0.2)] cursor-pointer"
                      : isDisabled
                      ? "bg-surface-container-high/40 border-outline-variant/10 text-on-surface-variant/40 cursor-not-allowed opacity-50"
                      : "bg-surface-container-high/60 border-outline-variant/10 text-on-surface hover:bg-white/5 hover:border-outline-variant/30 cursor-pointer"
                  }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`material-symbols-outlined !text-[16px] ${isSelected ? "text-primary" : "text-on-surface-variant/40"}`}>
                    {isSelected ? "check_box" : "check_box_outline_blank"}
                  </span>
                  <span className="text-xs font-medium truncate flex-1">{tableInfo.title || `Table ${id}`}</span>
                </div>
                <span className="text-[10px] text-on-surface-variant/50 ml-2 shrink-0">#{id}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const formatMessageContent = (content: string) => {
    // 1. Extract suggestions tag
    const suggestionsRegex = /<suggestions>([\s\S]*?)<\/suggestions>/i;
    const match = content.match(suggestionsRegex);
    let cleanContent = content;
    let suggestedIds: string[] = [];

    if (match) {
      cleanContent = content.replace(suggestionsRegex, "").trim();
      suggestedIds = match[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    // 2. Format the text content (excluding the suggestions block)
    const lines = cleanContent.split("\n");
    const parsedElements: React.ReactNode[] = [];
    let currentTableRows: string[][] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
        // Table row
        const cells = line
          .split("|")
          .map((c) => c.trim())
          .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);

        const isSeparator = cells.every((c) => /^[:-]+$/.test(c));
        if (!isSeparator) {
          currentTableRows.push(cells);
        }
      } else {
        if (currentTableRows.length > 0) {
          parsedElements.push(renderTableHelper(currentTableRows, parsedElements.length));
          currentTableRows = [];
        }
        parsedElements.push(renderNormalLine(line, parsedElements.length));
      }
    }

    if (currentTableRows.length > 0) {
      parsedElements.push(renderTableHelper(currentTableRows, parsedElements.length));
    }

    // 3. Append suggestions component at the bottom of the chat bubble
    if (suggestedIds.length > 0) {
      parsedElements.push(
        renderInteractiveSuggestions(suggestedIds, parsedElements.length)
      );
    }

    return parsedElements;
  };

  return (
    <div className="fixed bottom-8 right-8 z-50 flex flex-col items-end gap-4 pointer-events-none">
      {/* Chat Window Container */}
      <div
        className={`w-[480px] h-[530px] glass-panel rounded-xl shadow-2xl flex flex-col overflow-hidden border border-primary/20 backdrop-blur-xl transition-all duration-300 ease-out origin-bottom-right pointer-events-auto ${isOpen
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
                className="material-symbols-outlined text-on-surface-variant hover:text-error transition-colors text-lg cursor-pointer !shadow-none"
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

        {/* Reference Tables Selector Bar */}
        {otherTables.length > 0 && (
          <div className="relative border-b border-outline-variant/15 bg-surface-container-low/40" ref={refSelectorRef}>
            <button
              onClick={() => setShowRefSelector(!showRefSelector)}
              className="w-full px-4 py-2 flex items-center justify-between text-xs cursor-pointer hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-secondary !text-[16px]">link</span>
                <span className="text-on-surface-variant font-medium">
                  {selectedRefTableIds.size === 0
                    ? "Cross-reference other tables..."
                    : `${selectedRefTableIds.size} table${selectedRefTableIds.size > 1 ? "s" : ""} linked`}
                </span>
              </div>
              <span className={`material-symbols-outlined !text-[16px] text-on-surface-variant transition-transform ${showRefSelector ? "rotate-180" : ""}`}>
                expand_more
              </span>
            </button>

            {/* Selected table pills */}
            {selectedRefTableIds.size > 0 && !showRefSelector && (
              <div className="px-4 pb-2 flex flex-wrap gap-1">
                {Array.from(selectedRefTableIds).map((id) => {
                  const info = otherTables.find((t) => t.id === id);
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary/15 border border-secondary/20 text-[10px] text-secondary font-medium max-w-[180px]"
                    >
                      <span className="truncate">{info?.title || `Table ${id}`}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleRefTable(id);
                        }}
                        className="material-symbols-outlined !text-[12px] hover:text-error transition-colors cursor-pointer"
                      >
                        close
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Dropdown panel */}
            {showRefSelector && (
              <div className="absolute left-0 right-0 top-full z-50 bg-surface-container border border-outline-variant/20 rounded-b-xl shadow-xl max-h-[240px] flex flex-col overflow-hidden">
                {/* Search input */}
                <div className="p-2 border-b border-outline-variant/10">
                  <input
                    type="text"
                    placeholder="Search tables..."
                    value={refSearch}
                    onChange={(e) => setRefSearch(e.target.value)}
                    className="w-full bg-surface-container-high border border-outline-variant/20 rounded-md px-2.5 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>

                {/* Table list */}
                <div className="overflow-y-auto custom-scrollbar flex-1">
                  {filteredOtherTables.length === 0 ? (
                    <div className="p-3 text-center text-xs text-on-surface-variant/50">No tables found</div>
                  ) : (
                    filteredOtherTables.map((table) => {
                      const isSelected = selectedRefTableIds.has(table.id);
                      const isDisabled = !isSelected && selectedRefTableIds.size >= MAX_REF_TABLES;
                      return (
                        <button
                          key={table.id}
                          onClick={() => toggleRefTable(table.id)}
                          disabled={isDisabled}
                          className={`w-full px-3 py-2 flex items-center gap-2 text-left text-xs transition-colors
                            ${isSelected
                              ? "bg-secondary/10 text-secondary border-l-2 border-secondary cursor-pointer"
                              : isDisabled
                                ? "text-on-surface-variant/30 border-l-2 border-transparent cursor-not-allowed"
                                : "hover:bg-white/5 text-on-surface-variant border-l-2 border-transparent cursor-pointer"
                            }`}
                        >
                          <span className={`material-symbols-outlined !text-[16px] ${isSelected ? "text-secondary" : isDisabled ? "text-on-surface-variant/20" : "text-on-surface-variant/40"}`}>
                            {isSelected ? "check_box" : "check_box_outline_blank"}
                          </span>
                          <span className="truncate flex-1 font-medium">{table.title}</span>
                          <span className="text-[10px] text-on-surface-variant/40 shrink-0">#{table.id}</span>
                        </button>
                      );
                    })
                  )}
                </div>

                {/* Footer with clear action */}
                {selectedRefTableIds.size > 0 && (
                  <div className="p-2 border-t border-outline-variant/10 flex justify-between items-center">
                    <span className="text-[10px] text-on-surface-variant/60">
                      {selectedRefTableIds.size}/{MAX_REF_TABLES} selected
                    </span>
                    <button
                      onClick={() => setSelectedRefTableIds(new Set())}
                      className="text-[10px] text-error hover:text-error/80 font-medium cursor-pointer"
                    >
                      Clear all
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

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
          <div className="relative flex items-end">
            <textarea
              ref={textareaRef}
              className="w-full bg-surface-container-high border-outline-variant/30 rounded-lg py-2.5 pl-3 pr-12 text-[14px] text-on-surface focus:ring-primary focus:border-primary focus:outline-none transition-all placeholder:text-on-surface-variant/40 resize-none custom-scrollbar min-h-[38px] max-h-[120px]"
              placeholder="Ask about your data..."
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="absolute right-2 bottom-1.5 w-7 h-7 bg-primary text-background rounded-lg flex items-center justify-center shadow-md shadow-primary/10 hover:scale-105 active:scale-95 transition-all disabled:opacity-30 disabled:scale-100 cursor-pointer"
            >
              <span className="material-symbols-outlined !text-[16px] font-bold">send</span>
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
