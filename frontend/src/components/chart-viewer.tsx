/**
 * Dashify — Chart Viewer Component
 * Exact port of the Streamlit dash_no_ai.py survey dashboard to Next.js.
 * Intersection logic runs client-side (no server round-trips).
 */
"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import type {
  SurveyData,
  ChartType,
  SortOrder,
} from "@/lib/types";
import { COLOR_PALETTES, CHART_SIZES, NON_RESPONSE_ROWS } from "@/lib/types";
import { getAIInsights } from "@/lib/flask-api";
import { createClient } from "@/lib/supabase/client";

// Dynamic import for Plotly to avoid SSR issues
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false }) as any;

interface ChartViewerProps {
  surveyId: string;
  filename: string;
  surveyData: SurveyData;
  accessToken: string;
  role?: "admin" | "client_admin" | "analyst";
  companyId?: string;
}

// ============================================================================
// Utility functions (exact port from dash_no_ai.py)
// ============================================================================

function cleanTitle(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/\s*\([^)]*\)\s*/g, " ");
  cleaned = cleaned.replace(/^\s*[a-z0-9_.-]*\s*\.\s*/i, "");
  return cleaned.replace(/\s+/g, " ").trim();
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

function isResponseAnswer(answer: string): boolean {
  const upper = answer.trim().toUpperCase();
  const normalized = upper.replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  return !(
    NON_RESPONSE_ROWS.has(upper) ||
    NON_RESPONSE_ROWS.has(normalized) ||
    upper.startsWith("BASE") ||
    normalized.startsWith("BASE") ||
    upper.includes("SIGMA")
  );
}

function getAvailableColumns(
  tableData: Record<string, Record<string, number | string>>
): string[] {
  const cols = new Set<string>();
  for (const rowData of Object.values(tableData)) {
    for (const key of Object.keys(rowData)) {
      cols.add(key);
    }
  }
  return Array.from(cols).sort();
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Intersection calculations removed as requested.

// ============================================================================
// Component
// ============================================================================


export default function ChartViewer({
  surveyId,
  filename,
  surveyData,
  accessToken,
  role = "analyst",
  companyId = "",
}: ChartViewerProps) {
  // --- State ---
  const tableIds = useMemo(
    () => Object.keys(surveyData).sort((a, b) => parseInt(a) - parseInt(b)),
    [surveyData]
  );

  const [selectedTableId, setSelectedTableId] = useState(tableIds[0] || "");
  const [activeColumns, setActiveColumns] = useState<string[]>(["Total"]);
  const [showTopBreaks, setShowTopBreaks] = useState(false);
  const [topBreaksSearchQuery, setTopBreaksSearchQuery] = useState("");
  const plotRef = useRef<any>(null);
  const [chartType, setChartType] = useState<ChartType>("Bar");
  const [sortOrder, setSortOrder] = useState<SortOrder>("Highest to lowest");
  const [showAll, setShowAll] = useState(false);
  const [topN, setTopN] = useState(20);
  const [chartTitle, setChartTitle] = useState("");
  const [axisLabel, setAxisLabel] = useState("Percentage (%)");
  const [paletteName, setPaletteName] = useState("Default");
  const [chartSizeName, setChartSizeName] = useState<"Small" | "Medium" | "Large">("Medium");
  const [showLabels, setShowLabels] = useState(true);
  const [roundValues, setRoundValues] = useState(true);
  const [showGridlines, setShowGridlines] = useState(true);
  const [labelRotation, setLabelRotation] = useState(35);
  const [showCustomization, setShowCustomization] = useState(false);
  const [showTablePreview, setShowTablePreview] = useState(false);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const [questionSearch, setQuestionSearch] = useState("");

  const selectedTable = surveyData[selectedTableId];

  const currentTableTitleRef = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync questionSearch state when selectedTableId or selectedTable changes
  useEffect(() => {
    if (selectedTable) {
      const title = selectedTable.title || `Table ${selectedTableId}`;
      setQuestionSearch(title);
      currentTableTitleRef.current = title;
    }
  }, [selectedTableId, selectedTable]);

  // AI Insights state
  const [showInsights, setShowInsights] = useState(false);
  const [generatingInsights, setGeneratingInsights] = useState(false);
  const [insightContent, setInsightContent] = useState<any[] | null>(null);
  const [insightError, setInsightError] = useState<string | null>(null);

  const tableData = selectedTable?.data || {};
  const availableColumns = useMemo(
    () => getAvailableColumns(tableData),
    [tableData]
  );

  const filteredColumns = useMemo(() => {
    return availableColumns.filter((col) =>
      col.toLowerCase().includes(topBreaksSearchQuery.toLowerCase())
    );
  }, [availableColumns, topBreaksSearchQuery]);

  // Sync selected columns when table changes to filter out non-existent columns
  useEffect(() => {
    if (availableColumns.length > 0) {
      const filtered = activeColumns.filter((col) => availableColumns.includes(col));
      if (filtered.length === 0) {
        if (availableColumns.includes("Total")) {
          setActiveColumns(["Total"]);
        } else {
          setActiveColumns([availableColumns[0]]);
        }
      } else {
        setActiveColumns(filtered);
      }
    }
  }, [availableColumns]);

  // Map computedTableData directly to tableData (no intersection calculations)
  const computedTableData = tableData;

  const fetchAIInsights = useCallback(async (colsToUse?: string[]) => {
    const cols = Array.isArray(colsToUse) ? colsToUse : activeColumns;
    if (!selectedTableId || cols.length === 0) {
      setInsightContent(null);
      setInsightError(null);
      return;
    }
    setGeneratingInsights(true);
    setInsightError(null);
    setInsightContent(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || accessToken;
      const data = await getAIInsights(token, {
        survey_id: surveyId,
        table_id: selectedTableId,
        chart_type: chartType,
        active_columns: cols,
        save_to_cache: true,
      });
      setInsightContent(data.insight);
    } catch (err: any) {
      console.error("Error generating insights:", err);
      setInsightError(err.message || "Failed to generate insights.");
    } finally {
      setGeneratingInsights(false);
    }
  }, [accessToken, surveyId, selectedTableId, chartType, activeColumns]);

  // Auto-fetch insights when question selection or active columns change
  useEffect(() => {
    fetchAIInsights();
  }, [fetchAIInsights]);

  // Build chart data from computed table data (with intersections already in place)
  const chartData = useMemo(() => {
    const records: { answer: string; topBreak: string; value: number }[] = [];

    for (const [label, rowData] of Object.entries(computedTableData)) {
      if (!isResponseAnswer(label)) continue;

      const labelLower = label.toLowerCase().trim();
      if (labelLower === "unspecified") continue;
      if (/(?:top\s*2\s*box|bottom\s*2\s*box|top\s*two\s*box|bottom\s*two\s*box|t2b|b2b|top\s*box|bottom\s*box)/i.test(label))
        continue;

      let cleanLabel = label.replace(/\s*\([^)]*specify[^)]*\)/i, "");
      cleanLabel = cleanLabel.replace(/^\[[^\]]*\]\s*/, "").trim();

      for (const colName of activeColumns) {
        const val = toNumber(rowData[colName]);
        if (val !== null) {
          records.push({
            answer: cleanLabel,
            topBreak: colName,
            value: roundValues ? Math.round(val) : val,
          });
        }
      }
    }

    return records;
  }, [computedTableData, activeColumns, roundValues]);

  // Sort and limit
  const displayData = useMemo(() => {
    let data = [...chartData];

    if (sortOrder !== "Original table order") {
      const answerMax = new Map<string, number>();
      for (const r of data) {
        answerMax.set(r.answer, Math.max(answerMax.get(r.answer) || 0, r.value));
      }
      const sorted = [...answerMax.entries()].sort((a, b) =>
        sortOrder === "Highest to lowest" ? b[1] - a[1] : a[1] - b[1]
      );
      const order = sorted.map((s) => s[0]);
      data.sort(
        (a, b) => order.indexOf(a.answer) - order.indexOf(b.answer)
      );
    }

    if (!showAll) {
      const answerMax = new Map<string, number>();
      for (const r of data) {
        answerMax.set(r.answer, Math.max(answerMax.get(r.answer) || 0, r.value));
      }
      const topAnswers = [...answerMax.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map((s) => s[0]);
      data = data.filter((r) => topAnswers.includes(r.answer));
    }

    return data;
  }, [chartData, sortOrder, showAll, topN]);



  // --- Build Plotly figure ---
  const selectedGroup = activeColumns.join(", ");
  const defaultTitle = `${cleanTitle(selectedTable?.title || "Untitled")} by ${selectedGroup}`;
  const effectiveTitle = chartTitle || defaultTitle;
  const wrappedTitle = wrapText(effectiveTitle, 70).join("<br>");
  const colors = COLOR_PALETTES[paletteName] || COLOR_PALETTES.Default;
  const [chartW, chartH] = CHART_SIZES[chartSizeName] || CHART_SIZES.Medium;
  const width = chartW * 95;
  const height = chartH * 95;

  const traces = useMemo(() => {
    const uniqueBreaks = [...new Set(displayData.map((d) => d.topBreak))];

    return uniqueBreaks.map((breakName, idx) => {
      const filtered = displayData.filter((d) => d.topBreak === breakName);
      const answers = filtered.map((d) => d.answer);
      const values = filtered.map((d) => d.value);

      const baseTrace: Record<string, unknown> = {
        name: wrapText(breakName, 22).join("<br>"),
        marker: { color: colors[idx % colors.length] },
      };

      if (chartType === "Pie") {
        return {
          ...baseTrace,
          type: "pie" as const,
          labels: answers,
          values,
          textinfo: "label+percent",
          textposition: "inside",
        };
      }

      if (chartType === "Horizontal bar") {
        return {
          ...baseTrace,
          type: "bar" as const,
          x: values,
          y: answers,
          orientation: "h" as const,
          text: showLabels
            ? values.map((v) => (roundValues ? v.toFixed(0) : v.toFixed(2)))
            : undefined,
          textposition: "outside" as const,
          hovertemplate: `<b>${breakName}</b><br>%{y}: %{x:.1f}%<extra></extra>`,
        };
      }

      if (chartType === "Line") {
        return {
          ...baseTrace,
          type: "scatter" as const,
          mode: "lines+markers" as const,
          x: answers,
          y: values,
          text: showLabels
            ? values.map((v) => (roundValues ? v.toFixed(0) : v.toFixed(2)))
            : undefined,
          textposition: "top right" as const,
          hovertemplate: `<b>${breakName}</b><br>%{x}: %{y:.1f}%<extra></extra>`,
        };
      }

      return {
        ...baseTrace,
        type: "bar" as const,
        x: answers,
        y: values,
        text: showLabels
          ? values.map((v) => (roundValues ? v.toFixed(0) : v.toFixed(2)))
          : undefined,
        textposition: "outside" as const,
        hovertemplate: `<b>${breakName}</b><br>%{x}: %{y:.1f}%<extra></extra>`,
      };
    });
  }, [displayData, chartType, colors, showLabels, roundValues]);

  const displayAnswersCount = useMemo(() => new Set(displayData.map((d) => d.answer)).size, [displayData]);

  const plotHeight = useMemo(() => {
    return chartType === "Horizontal bar" ? Math.max(height, displayAnswersCount * 28 + 100) : height;
  }, [chartType, height, displayAnswersCount]);

  const handleDownloadChart = useCallback(async () => {
    if (!plotRef.current) return;

    const Plotly = (window as any).Plotly;
    if (!Plotly) {
      console.error("Plotly global library not found in window");
      return;
    }

    const filename = `table_${selectedTableId}_${chartType.toLowerCase().replace(" ", "_")}_${activeColumns.join("_").replace(/\s+/g, "_").substring(0, 40)}`;

    try {
      await Plotly.downloadImage(plotRef.current, {
        format: "png",
        width: width || 800,
        height: plotHeight || 600,
        scale: 3, // 3x resolution scale for crisp print-quality outputs
        filename: filename,
      });
    } catch (err) {
      console.error("Error downloading chart image:", err);
    }
  }, [selectedTableId, chartType, activeColumns, width, plotHeight]);

  const layout = useMemo(
    () => ({
      autosize: true,
      height: plotHeight,
      margin: {
        l: chartType === "Horizontal bar" ? 200 : 100,
        r: 50,
        t: 55,
        b: chartType === "Horizontal bar" ? 60 : 120,
      },
      plot_bgcolor: "white",
      paper_bgcolor: "white",
      barmode: "group" as const,
      font: {
        family: '"Hanken Grotesk", "Inter", "Helvetica Neue", Arial, sans-serif',
        color: "#475569",
      },
      title: {
        text: `<b>${wrappedTitle}</b>`,
        font: { size: 15, color: "#333333", family: '"Hanken Grotesk", "Inter", sans-serif' },
        xref: "paper" as const,
        yref: "container" as const,
        x: 0.5,
        y: 0.98,
        xanchor: "center" as const,
        yanchor: "top" as const,
      },
      xaxis: {
        showgrid: showGridlines,
        gridcolor: "#f1f5f9",
        showline: true,
        mirror: true,
        linecolor: "#cbd5e1",
        linewidth: 0.5,
        automargin: true,
        tickangle: chartType === "Horizontal bar" ? undefined : -labelRotation,
        title: chartType === "Horizontal bar" ? { text: axisLabel, font: { size: 11, color: "#475569", family: '"Inter", sans-serif' } } : undefined,
        tickfont: { size: 10, color: "#475569", family: '"Inter", sans-serif' },
      },
      yaxis: {
        showgrid: showGridlines,
        gridcolor: "#f1f5f9",
        showline: true,
        mirror: true,
        linecolor: "#cbd5e1",
        linewidth: 0.5,
        automargin: true,
        title: chartType !== "Horizontal bar" ? { text: axisLabel, font: { size: 11, color: "#475569", family: '"Inter", sans-serif' } } : undefined,
        tickfont: { size: 10, color: "#475569", family: '"Inter", sans-serif' },
      },
      showlegend: true,
      legend: {
        bgcolor: "rgba(255,255,255,0.9)",
        bordercolor: "#e2e8f0",
        borderwidth: 0.5,
        x: 1.02,
        y: 0.5,
        xanchor: "left" as const,
        yanchor: "middle" as const,
        font: { size: 10, family: '"Inter", sans-serif' },
      },
    }),
    [width, plotHeight, wrappedTitle, showGridlines, labelRotation, axisLabel, chartType]
  );

  const uniqueAnswers = new Set(chartData.map((d) => d.answer));

  const settingsPanel = (
    <div className="space-y-md text-on-surface text-label-sm pb-md">
      {/* Question Select (Autocomplete style) */}
      <div className="space-y-1">
        <label className="text-label-sm text-on-surface-variant block font-bold">
          Question Select
        </label>
        <input
          ref={inputRef}
          list="questions-datalist"
          value={questionSearch}
          onChange={(e) => {
            let val = e.target.value;
            const currentTitle = selectedTable?.title || `Table ${selectedTableId}`;
            if (val.includes(currentTitle) && val !== currentTitle) {
              val = val.replace(currentTitle, "");
            }
            setQuestionSearch(val);
            const matchedId = tableIds.find((id) => (surveyData[id]?.title || `Table ${id}`) === val);
            if (matchedId) {
              setSelectedTableId(matchedId);
            }
          }}
          onFocus={(e) => {
            e.target.value = "";
            setQuestionSearch("");
          }}
          onBlur={() => {
            setTimeout(() => {
              const currentVal = inputRef.current?.value || "";
              const isValid = tableIds.some((id) => (surveyData[id]?.title || `Table ${id}`) === currentVal);
              if (!isValid) {
                setQuestionSearch(currentTableTitleRef.current);
              }
            }, 200);
          }}
          className="w-full bg-surface-container-high border border-outline-variant/30 rounded-lg text-on-surface py-2 px-3 focus:ring-1 focus:ring-primary outline-none text-xs"
          placeholder="Type to search questions..."
        />
        <datalist id="questions-datalist">
          {tableIds.map((id) => (
            <option key={id} value={surveyData[id]?.title || `Table ${id}`} />
          ))}
        </datalist>
      </div>



      {/* Top Breaks Accordion */}
      <div className="pt-md border-t border-outline-variant/20">
        <button
          onClick={() => setShowTopBreaks(!showTopBreaks)}
          className="w-full flex items-center justify-between py-2 text-on-surface font-bold text-label-md group cursor-pointer !shadow-none hover:text-primary transition-colors"
        >
          Top Breaks Selection
          <span
            className={`material-symbols-outlined transition-transform duration-200 ${showTopBreaks ? "rotate-180" : ""
              }`}
          >
            expand_more
          </span>
        </button>

        {showTopBreaks && (
          <div className="space-y-sm mt-2 pt-2 border-t border-outline-variant/10">
            {/* Selected Pills */}
            <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto p-1 rounded-lg custom-scrollbar">
              {activeColumns.length === 0 ? (
                <span className="text-xs text-on-surface-variant/40 italic">No top breaks selected</span>
              ) : (
                <>
                  {activeColumns.map((col) => (
                    <span key={col} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary/10 border border-primary/20 text-primary">
                      {col.length > 15 ? col.slice(0, 13) + "..." : col}
                      <button
                        onClick={() => {
                          setActiveColumns(activeColumns.filter((c) => c !== col));
                        }}
                        className="hover:text-red-400 text-[9px] font-bold cursor-pointer ml-1 text-primary"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                  <button
                    onClick={() => setActiveColumns([])}
                    className="text-[10px] text-red-400 hover:text-red-300 font-bold ml-auto cursor-pointer !shadow-none"
                  >
                    Clear All
                  </button>
                </>
              )}
            </div>

            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                className="w-full bg-surface-container-high border border-outline-variant/30 rounded-lg text-on-surface py-1.5 px-3 focus:ring-1 focus:ring-primary outline-none text-xs"
                placeholder="Search top breaks..."
                value={topBreaksSearchQuery}
                onChange={(e) => setTopBreaksSearchQuery(e.target.value)}
              />
              {topBreaksSearchQuery && (
                <button
                  onClick={() => setTopBreaksSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-on-surface-variant/60 hover:text-on-surface cursor-pointer !shadow-none"
                >
                  ✕
                </button>
              )}
            </div>

            {/* List with Checkboxes */}
            <div className="flex flex-col gap-1 max-h-[180px] overflow-y-auto p-1.5 border border-outline-variant/10 rounded-lg bg-surface-container-high/30 custom-scrollbar">
              {filteredColumns.length === 0 ? (
                <span className="text-xs text-on-surface-variant/40 italic p-2 text-center">No matching top breaks</span>
              ) : (
                filteredColumns.map((col) => {
                  const isChecked = activeColumns.includes(col);
                  return (
                    <label
                      key={col}
                      className={`flex items-start gap-2 px-2 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-all hover:bg-white/10 ${isChecked
                          ? "bg-primary/10 text-primary font-semibold"
                          : "text-on-surface-variant"
                        }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          if (isChecked) {
                            setActiveColumns(activeColumns.filter((c) => c !== col));
                          } else {
                            setActiveColumns([...activeColumns, col]);
                          }
                        }}
                        className="rounded bg-surface-container border-outline-variant text-primary focus:ring-primary h-3.5 w-3.5 cursor-pointer shrink-0 mt-0.5"
                      />
                      <span className="whitespace-normal break-words leading-relaxed" title={col}>{col}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Chart Type Selector Grid */}
      <div className="space-y-1">
        <label className="text-label-sm text-on-surface-variant block font-bold">
          Chart Type
        </label>
        <div className="grid grid-cols-4 gap-2">
          {(["Bar", "Horizontal bar", "Line", "Pie"] as ChartType[]).map(
            (type) => {
              const iconName =
                type === "Bar"
                  ? "bar_chart"
                  : type === "Horizontal bar"
                    ? "horizontal_split"
                    : type === "Line"
                      ? "show_chart"
                      : "pie_chart";

              return (
                <button
                  key={type}
                  onClick={() => setChartType(type)}
                  title={type}
                  className={`p-2 rounded-lg border flex items-center justify-center transition-all cursor-pointer ${chartType === type
                    ? "bg-primary-container/30 border-primary text-primary"
                    : "bg-white/5 border-outline-variant/20 text-on-surface-variant hover:text-on-surface"
                    }`}
                >
                  <span className="material-symbols-outlined text-[20px]">
                    {iconName}
                  </span>
                </button>
              );
            }
          )}
        </div>
      </div>

      {/* Sort Order Selector */}
      <div className="space-y-1">
        <label className="text-label-sm text-on-surface-variant block font-bold">
          Sort Order
        </label>
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as SortOrder)}
          className="w-full bg-surface-container-high border border-outline-variant/30 rounded-lg text-on-surface py-2 px-3 outline-none cursor-pointer text-xs"
        >
          <option>Highest to lowest</option>
          <option>Lowest to highest</option>
          <option>Original table order</option>
        </select>
      </div>

      {/* Show all side breaks toggle */}
      <div className="flex items-center justify-between py-1">
        <span className="text-label-sm text-on-surface-variant">Show all breaks</span>
        <input
          type="checkbox"
          checked={showAll}
          onChange={(e) => setShowAll(e.target.checked)}
          className="rounded bg-surface-container border-outline-variant text-primary focus:ring-primary h-4 w-4 cursor-pointer"
        />
      </div>

      {!showAll && (
        <div className="space-y-1">
          <div className="flex justify-between text-label-sm text-on-surface-variant">
            <span>Top N</span>
            <span className="text-primary">{topN}</span>
          </div>
          <input
            type="range"
            min={5}
            max={50}
            step={5}
            value={topN}
            onChange={(e) => setTopN(parseInt(e.target.value))}
            className="w-full accent-primary h-1 bg-white/10 rounded-lg cursor-pointer"
          />
        </div>
      )}

      {/* Chart Customization Accordion */}
      <div className="pt-md border-t border-outline-variant/20">
        <button
          onClick={() => setShowCustomization(!showCustomization)}
          className="w-full flex items-center justify-between py-2 text-on-surface font-bold text-label-md group cursor-pointer !shadow-none hover:text-primary transition-colors"
        >
          Chart Customization
          <span
            className={`material-symbols-outlined transition-transform duration-200 ${showCustomization ? "rotate-180" : ""
              }`}
          >
            expand_more
          </span>
        </button>

        {showCustomization && (
          <div className="space-y-md mt-2 pt-2 border-t border-outline-variant/10">
            <div className="flex flex-col gap-1">
              <label className="text-label-sm text-on-surface-variant">Custom Title</label>
              <input
                type="text"
                value={chartTitle}
                onChange={(e) => setChartTitle(e.target.value)}
                placeholder={defaultTitle}
                className="bg-surface-container-high/60 border border-outline-variant/30 rounded-lg text-on-surface py-1.5 px-3 text-[11px] outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-label-sm text-on-surface-variant">Axis Label</label>
              <input
                type="text"
                value={axisLabel}
                onChange={(e) => setAxisLabel(e.target.value)}
                className="bg-surface-container-high/60 border border-outline-variant/30 rounded-lg text-on-surface py-1.5 px-3 text-[11px] outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-label-sm text-on-surface-variant">Color Palette</label>
              <select
                value={paletteName}
                onChange={(e) => setPaletteName(e.target.value)}
                className="bg-surface-container-high/60 border border-outline-variant/30 rounded-lg text-on-surface py-1.5 px-2 text-[11px] outline-none"
              >
                {Object.keys(COLOR_PALETTES).map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-label-sm text-on-surface-variant">Chart Size</label>
              <select
                value={chartSizeName}
                onChange={(e) => setChartSizeName(e.target.value as any)}
                className="bg-surface-container-high/60 border border-outline-variant/30 rounded-lg text-on-surface py-1.5 px-2 text-[11px] outline-none"
              >
                <option>Small</option>
                <option>Medium</option>
                <option>Large</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-label-sm text-on-surface-variant">Data labels</span>
              <input
                type="checkbox"
                checked={showLabels}
                onChange={(e) => setShowLabels(e.target.checked)}
                className="rounded bg-surface-container border-outline-variant text-primary focus:ring-primary h-4 w-4 cursor-pointer"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-label-sm text-on-surface-variant">Round values</span>
              <input
                type="checkbox"
                checked={roundValues}
                onChange={(e) => setRoundValues(e.target.checked)}
                className="rounded bg-surface-container border-outline-variant text-primary focus:ring-primary h-4 w-4 cursor-pointer"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-label-sm text-on-surface-variant">Gridlines</span>
              <input
                type="checkbox"
                checked={showGridlines}
                onChange={(e) => setShowGridlines(e.target.checked)}
                className="rounded bg-surface-container border-outline-variant text-primary focus:ring-primary h-4 w-4 cursor-pointer"
              />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-label-sm text-on-surface-variant">
                <span>Label Rotation</span>
                <span className="text-primary">{labelRotation}°</span>
              </div>
              <input
                type="range"
                min={0}
                max={90}
                step={5}
                value={labelRotation}
                onChange={(e) => setLabelRotation(parseInt(e.target.value))}
                className="w-full accent-primary h-1 bg-white/10 rounded-lg cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative animate-fade-in">
      {/* Main Body Layout (single column, full-width) */}
      <div className="pt-4 max-w-container-max mx-auto px-4 pb-xl flex flex-col gap-gutter">
        {/* Question Title & Mini Stats */}
        <div className="flex flex-col gap-md">
          <div>
            <div className="flex items-center gap-xs text-label-sm text-on-surface-variant mb-xs">
              <span className="material-symbols-outlined text-[16px]">description</span>
              <span className="font-bold">{filename}</span>
            </div>
            <h2 className="font-headline-lg text-headline-lg text-on-surface leading-tight">
              {cleanTitle(selectedTable?.title || "Untitled")}
            </h2>
          </div>

          <div className="flex flex-wrap gap-md">
            {/* Side breaks count */}
            <div className="glass-panel flex-1 min-w-[160px] p-md rounded-xl flex items-center gap-md">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined">analytics</span>
              </div>
              <div>
                <p className="text-label-sm text-on-surface-variant uppercase tracking-wider">
                  Side Breaks
                </p>
                <p className="text-headline-md font-bold text-on-surface">
                  {uniqueAnswers.size}
                </p>
              </div>
            </div>
            {/* Top Breaks count */}
            <div className="glass-panel flex-1 min-w-[160px] p-md rounded-xl flex items-center gap-md">
              <div className="w-12 h-12 rounded-lg bg-secondary/10 flex items-center justify-center text-secondary">
                <span className="material-symbols-outlined">filter_alt</span>
              </div>
              <div>
                <p className="text-label-sm text-on-surface-variant uppercase tracking-wider">
                  Top Breaks
                </p>
                <p className="text-headline-md font-bold text-on-surface">
                  {activeColumns.length}
                </p>
              </div>
            </div>
          </div>

          {/* Base Table Panel (Sample Bases) */}
          <div className="glass-panel rounded-xl overflow-hidden shadow-lg w-full">
            <div className="p-3 bg-white/5 border-b border-outline-variant/10">
              <h3 className="text-label-sm font-bold uppercase tracking-wider">
                Sample Bases
              </h3>
            </div>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left font-label-md">
                <thead className="text-on-surface-variant border-b border-outline-variant/10">
                  <tr>
                    <th className="px-md py-2 font-medium">Top Break</th>
                    <th className="px-md py-2 font-medium text-right">Base (n)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/5">
                  {activeColumns.map((col, idx) => {
                    const base = computedTableData["Weighted Sample"]?.[col]
                    return (
                      <tr key={idx} className="hover:bg-white/5 transition-colors">
                        <td className="px-md py-2 break-words max-w-[200px]" title={col}>
                          {col}
                        </td>
                        <td className="px-md py-2 text-right">
                          {typeof base === "number"
                            ? base.toLocaleString("en-IN", { maximumFractionDigits: 0 })
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Interactive Chart Container */}
        <div className="glass-panel p-md rounded-xl flex flex-col relative">
          <div className="flex items-center justify-between mb-md">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-primary"></span>
              <span className="text-label-sm text-on-surface-variant pr-4">Active Chart</span>
              {chartType === "Pie" && activeColumns.length > 1 && (
                <span className="text-label-sm text-secondary">
                  Pie chart shows {activeColumns[0]}. Choose one top break for a different pie.
                </span>
              )}
            </div>

            <button
              onClick={handleDownloadChart}
              className="flex items-center gap-xs px-3 py-1.5 bg-surface-container-high hover:bg-primary/20 text-on-surface-variant hover:text-primary border border-outline-variant/10 rounded-xl font-bold text-xs transition-all active:scale-95 cursor-pointer !shadow-none"
              title="Download Chart as PNG"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              Download Chart
            </button>
          </div>

          {/* Plotly Frame */}
          <div className="w-full chart-container overflow-hidden flex items-center justify-center p-sm shadow-inner relative bg-white" style={{ height: `${plotHeight}px` }}>
            {traces.length > 0 ? (
              <Plot
                data={traces as any[]}
                layout={layout as any}
                config={{
                  displayModeBar: false,
                }}
                onInitialized={(figure: any, graphDiv: any) => {
                  plotRef.current = graphDiv;
                }}
                onUpdate={(figure: any, graphDiv: any) => {
                  plotRef.current = graphDiv;
                }}
                useResizeHandler
                style={{ width: "100%", height: "100%" }}
              />
            ) : (
              <div className="text-slate-400 font-label-md">
                No response rows available to display.
              </div>
            )}
          </div>
        </div>

        {/* AI Insights Section */}
        <div className="glass-panel rounded-xl overflow-hidden shadow-lg mt-sm">
          <button
            onClick={() => setShowInsights(!showInsights)}
            className="w-full p-gutter flex items-center justify-between border-b border-outline-variant/10 bg-white/5 cursor-pointer outline-none"
          >
            <h3 className="font-headline-md text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">auto_awesome</span>
              AI Strategic Insights
            </h3>
            <span className={`material-symbols-outlined transition-transform duration-200 ${showInsights ? "rotate-180" : ""}`}>
              expand_more
            </span>
          </button>

          {showInsights && (
            <div className="p-gutter space-y-md bg-surface-container-low/30">
              {!insightContent && !generatingInsights && !insightError && (
                <div className="flex flex-col items-center justify-center py-lg text-center">
                  <p className="text-on-surface-variant text-sm max-w-xxl">
                    {activeColumns.length === 0
                      ? "Select one or more columns/groups in the sidebar to auto-generate strategic insights."
                      : "No insights found."}
                  </p>
                </div>
              )}

              {generatingInsights && (
                <div className="flex flex-col items-center justify-center py-xl text-center gap-md">
                  <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                  <p className="text-sm font-bold text-primary animate-pulse">
                    Analyzing survey data & synthesizing market findings...
                  </p>
                </div>
              )}

              {insightError && (
                <div className="p-md rounded-xl border border-error/20 bg-error/5 flex flex-col gap-sm">
                  <p className="text-sm text-error font-medium">{insightError}</p>
                  <button
                    onClick={() => fetchAIInsights()}
                    className="text-xs text-primary hover:text-primary-container font-bold self-start cursor-pointer"
                  >
                    Try Again
                  </button>
                </div>
              )}

              {insightContent && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
                  {insightContent.map((item, idx) => (
                    <div key={idx} className="p-md rounded-xl bg-white/5 border border-outline-variant/10 flex flex-col gap-xs relative overflow-hidden group hover:border-primary/30 transition-all duration-300">
                      <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-primary to-secondary"></div>
                      <div className="pl-xs space-y-2">
                        <span className="text-xs uppercase font-bold tracking-wider text-primary-fixed">
                          {item.Topic}
                        </span>
                        <p className="text-sm text-on-surface font-medium leading-relaxed">
                          {item.Insight}
                        </p>
                        <div className="pt-2 border-t border-outline-variant/10 space-y-1">
                          <span className="text-[11px] font-bold text-primary uppercase tracking-wider block">
                            Strategic Takeaway
                          </span>
                          <p className="text-xs text-on-surface-variant leading-relaxed">
                            {item.Takeaway}
                          </p>
                        </div>
                        {item["Data Reference"] && (
                          <div className="mt-2 text-[11px] text-on-surface-variant/60 font-mono italic">
                            Reference: {item["Data Reference"]}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Cross-tab Data Table Section */}
        <section className="glass-panel rounded-xl overflow-hidden shadow-lg">
          <button
            onClick={() => setShowTablePreview(!showTablePreview)}
            className="w-full p-gutter flex items-center justify-between border-b border-outline-variant/10 bg-white/5 cursor-pointer outline-none"
          >
            <h3 className="font-headline-md text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">data_object</span>
              Data Table Preview
            </h3>
            <span className={`material-symbols-outlined transition-transform duration-200 ${showTablePreview ? "rotate-180" : ""}`}>
              expand_more
            </span>
          </button>
          {showTablePreview && (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left font-label-md whitespace-nowrap">
                <thead className="bg-white/5 text-on-surface-variant border-b border-outline-variant/20">
                  <tr>
                    <th className="px-md py-4 font-bold">Side Breaks</th>
                    {activeColumns.map((col) => (
                      <th key={col} className="px-md py-4 font-bold">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/5">
                  {[...uniqueAnswers]
                    .sort((a, b) => {
                      const aMax = Math.max(
                        ...chartData.filter((d) => d.answer === a).map((d) => d.value),
                        0
                      );
                      const bMax = Math.max(
                        ...chartData.filter((d) => d.answer === b).map((d) => d.value),
                        0
                      );
                      return bMax - aMax;
                    })
                    .map((answer) => (
                      <tr key={answer} className="hover:bg-white/5 transition-colors">
                        <td className="px-md py-3 text-primary truncate max-w-[240px]" title={answer}>
                          {answer}
                        </td>
                        {activeColumns.map((col) => {
                          const record = chartData.find(
                            (d) => d.answer === answer && d.topBreak === col
                          );
                          return (
                            <td key={col} className="px-md py-3 font-semibold text-on-surface">
                              {record
                                ? roundValues
                                  ? `${record.value.toFixed(0)}%`
                                  : `${record.value.toFixed(2)}%`
                                : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Background Atmospheric Effect */}
      <div className="fixed inset-0 pointer-events-none z-[-1] overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-primary/5 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-secondary/5 blur-[120px] rounded-full"></div>
      </div>

      {mounted && typeof document !== "undefined" && document.getElementById("sidebar-settings-portal") &&
        createPortal(settingsPanel, document.getElementById("sidebar-settings-portal")!)}
    </div>
  );
}

