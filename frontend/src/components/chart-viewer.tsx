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
import ChartChatAssistant from "@/components/chart-chat-assistant";

// Dynamic import for Plotly to avoid SSR issues
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false }) as any;

interface ChartViewerProps {
  surveyId: string;
  filename: string;
  surveyData: SurveyData;
  accessToken: string;
  role?: "super_admin" | "admin" | "client_admin" | "analyst";
  companyId?: string;
}

// ============================================================================
// Utility functions (exact port from dash_no_ai.py)
// ============================================================================

function cleanTitle(text: string): string {
  let cleaned = text.trim();
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

function wrapAndHyphenate(text: string, width: number, maxLines: number): string {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (let i = 0; i < words.length; i++) {
    let word = words[i];

    // If the word itself is longer than width, we must hyphenate/split it
    if (word.length > width) {
      // If we have some content in the current line, push it to lines first
      if (currentLine) {
        lines.push(currentLine);
        currentLine = "";
      }

      // Split the long word into chunks of width - 1 with hyphens
      while (word.length > width) {
        const chunk = word.slice(0, width - 1) + "-";
        lines.push(chunk);
        word = word.slice(width - 1);
      }
      currentLine = word; // Remaining part of the word
    } else {
      // Check if adding this word exceeds the width
      const testLine = currentLine ? currentLine + " " + word : word;
      if (testLine.length > width) {
        if (currentLine) {
          lines.push(currentLine);
        }
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }

  // Now apply maxLines truncation
  if (lines.length > maxLines) {
    const allowedLines = lines.slice(0, maxLines);
    // Take the last allowed line, remove any trailing hyphen, and append "..."
    let lastLine = allowedLines[maxLines - 1];
    if (lastLine.endsWith("-")) {
      lastLine = lastLine.slice(0, -1);
    }
    // Truncate lastLine if adding "..." would make it exceed the width
    if (lastLine.length + 3 > width) {
      lastLine = lastLine.slice(0, width - 3);
    }
    allowedLines[maxLines - 1] = lastLine + "...";
    return allowedLines.join("<br>");
  }

  return lines.join("<br>");
}

function computeIntersectionColumn(
  tableData: Record<string, Record<string, number | string>>,
  selectedCols: string[]
): string {
  if (selectedCols.length < 2) {
    return selectedCols[0] || "Total";
  }

  const combinedName = selectedCols.join(" & ");

  // 1. Estimate base sizes for Weighted Sample and Unweighted Sample
  for (const baseKey of ["Weighted Sample", "Unweighted Sample"]) {
    if (baseKey in tableData) {
      const baseRow = tableData[baseKey];
      const totalBase = toNumber(baseRow["Total"]);

      if (totalBase === null || totalBase <= 0) {
        const bases = selectedCols
          .filter((col) => col in baseRow)
          .map((col) => toNumber(baseRow[col]))
          .filter((b): b is number => b !== null);
        tableData[baseKey][combinedName] = bases.length > 0 ? Math.min(...bases) : 0.0;
      } else {
        const bases = selectedCols
          .filter((col) => col in baseRow)
          .map((col) => toNumber(baseRow[col]))
          .filter((b): b is number => b !== null);

        if (bases.length > 0) {
          // Overflow-safe multiplication of ratios
          let prod = bases[0];
          for (let i = 1; i < bases.length; i++) {
            prod *= bases[i] / totalBase;
          }
          tableData[baseKey][combinedName] = prod;
        } else {
          tableData[baseKey][combinedName] = 0.0;
        }
      }
    }
  }

  // 2. Compute the cell values for responses
  const responseLabels = Object.keys(tableData).filter((label) =>
    isResponseAnswer(label)
  );

  // Check if the calculated weighted base is 0 (or less than 0.5)
  const weightedBase = toNumber(
    tableData["Weighted Sample"]?.[combinedName]
  );
  const isEmptyBase = weightedBase !== null && weightedBase < 0.5;

  const rawVals: Record<string, number> = {};
  let sumRaw = 0.0;

  const sumInputs: Record<string, number> = {};
  for (const col of selectedCols) {
    sumInputs[col] = 0.0;
  }

  for (const label of responseLabels) {
    const rowVals = tableData[label];
    const totalVal = toNumber(rowVals["Total"]);

    const colVals: number[] = [];
    for (const col of selectedCols) {
      const val = toNumber(rowVals[col]);
      if (val !== null) {
        colVals.push(val);
        sumInputs[col] += val;
      }
    }

    if (colVals.length === 0) continue;

    let est: number;
    if (totalVal === null || totalVal <= 0) {
      est = colVals.reduce((a, b) => a + b, 0) / colVals.length;
    } else {
      // Overflow-safe ratio multiplication
      est = colVals[0];
      for (let i = 1; i < colVals.length; i++) {
        est *= colVals[i] / totalVal;
      }
    }

    rawVals[label] = est;
    sumRaw += est;
  }

  // 3. Normalize percentages
  const avgSumInputs =
    selectedCols.length > 0
      ? Object.values(sumInputs).reduce((a, b) => a + b, 0) / selectedCols.length
      : 100.0;
  const factor = sumRaw > 0 ? avgSumInputs / sumRaw : 1.0;

  for (const label of responseLabels) {
    if (isEmptyBase) {
      tableData[label][combinedName] = 0.0;
    } else if (label in rawVals) {
      tableData[label][combinedName] = rawVals[label] * factor;
    }
  }

  return combinedName;
}

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
  const [groups, setGroups] = useState<string[][]>([["Total"]]);
  const [inputValues, setInputValues] = useState<Record<number, string>>({});
  const plotRef = useRef<any>(null);
  const [chartType, setChartType] = useState<ChartType>("Bar");
  const [sortOrder, setSortOrder] = useState<SortOrder>("Highest to lowest");
  const [showAll, setShowAll] = useState(false);
  const [topN, setTopN] = useState(20);
  const [chartTitle, setChartTitle] = useState("");
  const [axisLabel, setAxisLabel] = useState("Percentage (%)");
  const [paletteName, setPaletteName] = useState("Maruti");
  const [chartSizeName, setChartSizeName] = useState<"Small" | "Medium" | "Large">("Medium");
  const [showLabels, setShowLabels] = useState(true);
  const [roundValues, setRoundValues] = useState(true);
  const [showGridlines, setShowGridlines] = useState(true);
  const [labelRotation, setLabelRotation] = useState(35);
  const [chartFontSize, setChartFontSize] = useState(12);
  const [legendPosition, setLegendPosition] = useState("Outside Right");
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
      setChartTitle(""); // Reset custom chart title on table change
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

  // Sync groups when table changes to filter out non-existent columns
  useEffect(() => {
    if (availableColumns.length > 0) {
      const newGroups = groups
        .map((group) => group.filter((col) => availableColumns.includes(col)))
        .filter((group) => group.length > 0);
      
      if (newGroups.length === 0) {
        if (availableColumns.includes("Total")) {
          setGroups([["Total"]]);
        } else {
          setGroups([[availableColumns[0]]]);
        }
      } else {
        setGroups(newGroups);
      }
    }
  }, [availableColumns]);

  // Compute active columns — intersection runs client-side, mutating a deep copy
  const { activeColumns, computedTableData } = useMemo(() => {
    // Deep copy table data so intersection writes don't mutate original surveyData
    const dataCopy: Record<string, Record<string, number | string>> = {};
    for (const [key, val] of Object.entries(tableData)) {
      dataCopy[key] = { ...val };
    }

    const cols: string[] = [];
    for (const group of groups) {
      if (group.length >= 2) {
        const combinedCol = computeIntersectionColumn(dataCopy, group);
        cols.push(combinedCol);
      } else if (group.length === 1) {
        cols.push(group[0]);
      }
    }

    return { activeColumns: cols, computedTableData: dataCopy };
  }, [tableData, groups]);

  const handleGroupChange = useCallback(
    (groupIdx: number, cols: string[]) => {
      const newGroups = [...groups];
      newGroups[groupIdx] = cols;
      setGroups(newGroups);
    },
    [groups]
  );

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
      const wrappedAnswers = answers.map((ans) => {
        if (chartType === "Pie") {
          return wrapAndHyphenate(ans, 20, 3);
        }
        return wrapText(ans, 30).join("<br>");
      });

      const baseTrace: Record<string, unknown> = {
        name: wrapText(breakName, 22).join("<br>"),
        marker: { color: colors[idx % colors.length] },
      };

      if (chartType === "Pie") {
        return {
          ...baseTrace,
          type: "pie" as const,
          labels: wrappedAnswers,
          values,
          textinfo: "label+percent",
          textposition: "inside",
          insidetextorientation: "horizontal" as const,
          marker: {
            colors: answers.map((_, i) => colors[i % colors.length]),
          },
        };
      }

      if (chartType === "Horizontal bar") {
        return {
          ...baseTrace,
          type: "bar" as const,
          x: values,
          y: wrappedAnswers,
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
          x: wrappedAnswers,
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
        x: wrappedAnswers,
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

  const titleLinesCount = useMemo(() => {
    return wrapText(effectiveTitle, 70).length;
  }, [effectiveTitle]);

  const topMargin = useMemo(() => {
    return Math.max(75, titleLinesCount * (chartFontSize + 8) + 25);
  }, [titleLinesCount, chartFontSize]);

  const maxAnswerLines = useMemo(() => {
    let maxLines = 1;
    for (const r of displayData) {
      const lines = wrapText(r.answer, 30).length;
      if (lines > maxLines) maxLines = lines;
    }
    return maxLines;
  }, [displayData]);

  const bottomMargin = useMemo(() => {
    if (legendPosition === "Outside Bottom") {
      return chartType === "Horizontal bar" ? 140 : 190;
    }
    if (chartType === "Horizontal bar") {
      return 60;
    }
    return Math.max(125, maxAnswerLines * 18 + 75);
  }, [chartType, legendPosition, maxAnswerLines]);

  const totalAnswerLinesCount = useMemo(() => {
    const uniqueAnswers = new Set(displayData.map((d) => d.answer));
    let count = 0;
    for (const ans of uniqueAnswers) {
      count += wrapText(ans, 30).length;
    }
    return count || 1;
  }, [displayData]);

  const plotHeight = useMemo(() => {
    const baseHeight = chartType === "Horizontal bar"
      ? Math.max(height, displayAnswersCount * 22 + totalAnswerLinesCount * 16 + 100)
      : height;
    const extraMarginPadding = (topMargin - 60) + (bottomMargin - 120);
    return baseHeight + Math.max(0, extraMarginPadding);
  }, [chartType, height, displayAnswersCount, totalAnswerLinesCount, topMargin, bottomMargin]);

  // Compute active columns with low base size (< 30)
  const lowBaseColumns = useMemo(() => {
    return activeColumns.filter((col) => {
      const baseRaw = computedTableData["Unweighted Sample"]?.[col] ?? computedTableData["Weighted Sample"]?.[col];
      const base = typeof baseRaw === "number" ? baseRaw : parseFloat(String(baseRaw));
      return !isNaN(base) && base < 30;
    });
  }, [activeColumns, computedTableData]);



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

  const legendConfig = useMemo(() => {
    const configMap: Record<
      string,
      {
        x: number;
        y: number;
        xanchor: "left" | "right" | "center";
        yanchor: "top" | "bottom" | "middle";
        orientation: "h" | "v";
        show: boolean;
      }
    > = {
      "Outside Right": { x: 1.02, y: 0.5, xanchor: "left", yanchor: "middle", orientation: "v", show: true },
      "Inside Top Right": { x: 0.98, y: 0.98, xanchor: "right", yanchor: "top", orientation: "v", show: true },
      "Inside Top Left": { x: 0.02, y: 0.98, xanchor: "left", yanchor: "top", orientation: "v", show: true },
      "Inside Bottom Right": { x: 0.98, y: 0.02, xanchor: "right", yanchor: "bottom", orientation: "v", show: true },
      "Inside Bottom Left": { x: 0.02, y: 0.02, xanchor: "left", yanchor: "bottom", orientation: "v", show: true },
      "Outside Bottom": { x: 0.5, y: -0.22, xanchor: "center", yanchor: "top", orientation: "h", show: true },
      "Hidden": { x: 0, y: 0, xanchor: "left", yanchor: "top", orientation: "v", show: false },
    };
    return configMap[legendPosition] || configMap["Outside Right"];
  }, [legendPosition]);

  const layout = useMemo(
    () => ({
      autosize: true,
      height: plotHeight,
      margin: {
        l: chartType === "Horizontal bar" ? 200 : 100,
        r: 50,
        t: topMargin,
        b: bottomMargin,
      },
      plot_bgcolor: "white",
      paper_bgcolor: "white",
      barmode: "group" as const,
      bargap: 0.25,
      font: {
        family: '"Hanken Grotesk", "Inter", "Helvetica Neue", Arial, sans-serif',
        color: "#475569",
        size: chartFontSize,
      },
      title: {
        text: `<b>${wrappedTitle}</b>`,
        font: { size: chartFontSize + 3, color: "#333333", family: '"Hanken Grotesk", "Inter", sans-serif' },
        xref: "container" as const,
        yref: "container" as const,
        x: 0.5,
        y: 0.97,
        xanchor: "center" as const,
        yanchor: "top" as const,
      },
      xaxis: {
        type: chartType !== "Horizontal bar" ? ("category" as const) : undefined,
        showgrid: showGridlines,
        gridcolor: "#f1f5f9",
        showline: true,
        mirror: true,
        linecolor: "#cbd5e1",
        linewidth: 0.5,
        automargin: true,
        tickangle: chartType === "Horizontal bar" ? undefined : -labelRotation,
        title: chartType === "Horizontal bar" ? { text: axisLabel, font: { size: chartFontSize - 1, color: "#475569", family: '"Inter", sans-serif' } } : undefined,
        tickfont: { size: chartFontSize - 2, color: "#475569", family: '"Inter", sans-serif' },
      },
      yaxis: {
        type: chartType === "Horizontal bar" ? ("category" as const) : undefined,
        showgrid: showGridlines,
        gridcolor: "#f1f5f9",
        showline: true,
        mirror: true,
        linecolor: "#cbd5e1",
        linewidth: 0.5,
        automargin: true,
        title: chartType !== "Horizontal bar" ? { text: axisLabel, font: { size: chartFontSize - 1, color: "#475569", family: '"Inter", sans-serif' } } : undefined,
        tickfont: { size: chartFontSize - 2, color: "#475569", family: '"Inter", sans-serif' },
      },
      showlegend: legendConfig.show,
      legend: {
        bgcolor: "rgba(255,255,255,0.9)",
        bordercolor: "#e2e8f0",
        borderwidth: 0.5,
        x: legendConfig.x,
        y: legendConfig.y,
        xanchor: legendConfig.xanchor,
        yanchor: legendConfig.yanchor,
        orientation: legendConfig.orientation as "h" | "v",
        font: { size: chartFontSize - 2, family: '"Inter", sans-serif' },
      },
    }),
    [width, plotHeight, wrappedTitle, showGridlines, labelRotation, axisLabel, chartType, chartFontSize, legendPosition, legendConfig, topMargin, bottomMargin]
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



      {/* Top Breaks Comparison */}
      <div className="space-y-sm pt-2">
        <p className="text-label-sm font-bold text-on-surface border-b border-outline-variant/10 pb-1">
          Top Breaks Comparison (Groups)
        </p>

        <div className="space-y-xs max-h-[280px] overflow-y-auto custom-scrollbar">
          {groups.map((group, idx) => (
            <div
              key={idx}
              className="p-2 rounded-lg bg-white/5 border border-outline-variant/10 flex flex-col gap-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-label-sm text-secondary font-bold">
                  Group {idx + 1}
                </span>
                {groups.length > 1 && (
                  <button
                    onClick={() => {
                      setGroups(groups.filter((_, i) => i !== idx));
                    }}
                    className="text-on-surface-variant hover:text-error text-label-sm cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {group.map((col) => (
                  <span key={col} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 border border-primary/20 text-primary">
                    {col.length > 20 ? col.slice(0, 18) + "..." : col}
                    <button
                      onClick={() => {
                        const newCols = group.filter((c) => c !== col);
                        handleGroupChange(idx, newCols);
                      }}
                      className="hover:text-red-400 text-[10px] font-bold cursor-pointer ml-1 text-primary"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>

              <input
                list={`datalist-group-${idx}`}
                className="w-full bg-surface-container-high border border-outline-variant/30 rounded-lg text-on-surface py-1.5 px-3 focus:ring-1 focus:ring-primary outline-none text-xs"
                placeholder="+ Add column (type to search)..."
                value={inputValues[idx] || ""}
                onChange={(e) => {
                  const col = e.target.value;
                  setInputValues((prev) => ({ ...prev, [idx]: col }));

                  const validColumns = availableColumns.filter((c) => !group.includes(c));
                  if (validColumns.includes(col)) {
                    const newCols = [...group, col];
                    handleGroupChange(idx, newCols);
                    setInputValues((prev) => ({ ...prev, [idx]: "" }));
                  }
                }}
              />
              <datalist id={`datalist-group-${idx}`}>
                {availableColumns
                  .filter((col) => !group.includes(col))
                  .map((col) => (
                    <option key={col} value={col} />
                  ))}
              </datalist>
            </div>
          ))}
        </div>

        <button
          onClick={() =>
            setGroups([...groups, []])
          }
          className="w-full py-2 border border-dashed border-primary/45 rounded-lg text-primary text-label-md flex items-center justify-center gap-1 hover:bg-primary/10 transition-colors cursor-pointer !shadow-none"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          Add Top Break Group
        </button>
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
                value={chartTitle || defaultTitle}
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
            <div className="flex flex-col gap-1">
              <label className="text-label-sm text-on-surface-variant">Legend Position</label>
              <select
                value={legendPosition}
                onChange={(e) => setLegendPosition(e.target.value)}
                className="bg-surface-container-high/60 border border-outline-variant/30 rounded-lg text-on-surface py-1.5 px-2 text-[11px] outline-none"
              >
                <option>Outside Right</option>
                <option>Inside Top Right</option>
                <option>Inside Top Left</option>
                <option>Inside Bottom Right</option>
                <option>Inside Bottom Left</option>
                <option>Outside Bottom</option>
                <option>Hidden</option>
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
            <div className="space-y-1">
              <div className="flex justify-between text-label-sm text-on-surface-variant">
                <span>Text Size</span>
                <span className="text-primary">{chartFontSize}px</span>
              </div>
              <input
                type="range"
                min={8}
                max={24}
                step={1}
                value={chartFontSize}
                onChange={(e) => setChartFontSize(parseInt(e.target.value))}
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
            {/* Groups count */}
            <div className="glass-panel flex-1 min-w-[160px] p-md rounded-xl flex items-center gap-md">
              <div className="w-12 h-12 rounded-lg bg-secondary/10 flex items-center justify-center text-secondary">
                <span className="material-symbols-outlined">group</span>
              </div>
              <div>
                <p className="text-label-sm text-on-surface-variant uppercase tracking-wider">
                  Groups
                </p>
                <p className="text-headline-md font-bold text-on-surface">
                  {groups.length}
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
                    <th className="px-md py-2 font-medium">Group</th>
                    <th className="px-md py-2 font-medium">Top Break</th>
                    <th className="px-md py-2 font-medium text-right">Base (n)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/5">
                  {activeColumns.map((col, idx) => {
                    const base = computedTableData["Weighted Sample"]?.[col]
                    return (
                      <tr key={idx} className="hover:bg-white/5 transition-colors">
                        <td className="px-md py-2 text-secondary font-bold">
                          Group {idx + 1}
                        </td>
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

          {/* Low Base Size Warning Banner */}
          {lowBaseColumns.length > 0 && (
            <div className="flex items-start gap-md p-md rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-400 animate-fade-in">
              <span className="material-symbols-outlined text-[20px] shrink-0 mt-0.5">warning</span>
              <div>
                <p className="text-xs font-bold leading-normal">
                  Caution: Low sample size ( &lt;30) for top break(s): <span className="underline font-mono">{lowBaseColumns.join(", ")}</span>.
                </p>
                <p className="text-[10px] text-amber-400/80 mt-0.5 leading-normal">
                  Calculated from unweighted sample sizes where available. Small base sizes increase margins of error. Interpret these findings with caution.
                </p>
              </div>
            </div>
          )}
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

      {/* Floating Chatbot Assistant overlay */}
      {(role === "super_admin" || role === "admin") && (
        <ChartChatAssistant
          surveyId={surveyId}
          tableId={selectedTableId}
          tableTitle={selectedTable?.title || `Table ${selectedTableId}`}
          activeColumns={activeColumns}
          tableData={computedTableData}
          accessToken={accessToken}
        />
      )}

      {mounted && typeof document !== "undefined" && document.getElementById("sidebar-settings-portal") &&
        createPortal(settingsPanel, document.getElementById("sidebar-settings-portal")!)}
    </div>
  );
}

