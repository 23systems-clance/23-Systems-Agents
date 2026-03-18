"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";
function CodeLogView({ logs, expandedTools: externalExpanded, toggleTool: externalToggle }) {
  const [internalExpanded, setInternalExpanded] = useState(/* @__PURE__ */ new Set());
  const expandedTools = externalExpanded || internalExpanded;
  const toggleTool = externalToggle || ((id) => {
    setInternalExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  });
  const toolResults = /* @__PURE__ */ new Map();
  for (const entry of logs) {
    if (!entry.parsed) continue;
    for (const ev of entry.parsed) {
      if (ev.type === "tool-result" && ev.toolCallId) {
        toolResults.set(ev.toolCallId, ev);
      }
    }
  }
  const elements = [];
  for (let i = 0; i < logs.length; i++) {
    const entry = logs[i];
    if (!entry.parsed) continue;
    for (const ev of entry.parsed) {
      if (ev.type === "text" && ev.text) {
        elements.push(
          /* @__PURE__ */ jsx("div", { className: "text-foreground whitespace-pre-wrap mb-1 leading-relaxed", children: ev.text }, `${i}-text`)
        );
      } else if (ev.type === "tool-call") {
        const expanded = expandedTools.has(ev.toolCallId);
        const result = toolResults.get(ev.toolCallId);
        const keyArg = ev.args ? Object.values(ev.args)[0] : "";
        const keyArgStr = typeof keyArg === "string" ? keyArg : "";
        const shortArg = keyArgStr.length > 60 ? keyArgStr.slice(0, 57) + "..." : keyArgStr;
        elements.push(
          /* @__PURE__ */ jsxs("div", { className: "my-1", children: [
            /* @__PURE__ */ jsxs(
              "button",
              {
                onClick: () => toggleTool(ev.toolCallId),
                className: "flex items-center gap-1.5 w-full text-left px-2 py-1 rounded bg-muted/60 hover:bg-muted transition-colors",
                children: [
                  /* @__PURE__ */ jsx("span", { className: "text-muted-foreground text-xs", children: expanded ? "\u25BC" : "\u25B6" }),
                  /* @__PURE__ */ jsx("span", { className: "font-medium text-xs text-primary", children: ev.toolName }),
                  shortArg && /* @__PURE__ */ jsxs("span", { className: "text-muted-foreground text-xs truncate", children: [
                    "(",
                    shortArg,
                    ")"
                  ] })
                ]
              }
            ),
            expanded && /* @__PURE__ */ jsxs("div", { className: "ml-4 mt-1 space-y-1", children: [
              /* @__PURE__ */ jsx("pre", { className: "text-xs text-muted-foreground whitespace-pre-wrap break-all bg-muted/30 rounded p-1.5 max-h-48 overflow-y-auto", children: JSON.stringify(ev.args, null, 2) }),
              result && /* @__PURE__ */ jsxs("div", { className: "text-xs text-muted-foreground", children: [
                /* @__PURE__ */ jsx("span", { className: "font-medium", children: "Result:" }),
                /* @__PURE__ */ jsx("pre", { className: "whitespace-pre-wrap break-all bg-muted/30 rounded p-1.5 mt-0.5 max-h-48 overflow-y-auto", children: typeof result.result === "string" ? result.result : JSON.stringify(result.result, null, 2) })
              ] })
            ] })
          ] }, `${i}-tool-${ev.toolCallId}`)
        );
      }
    }
  }
  return /* @__PURE__ */ jsx("div", { children: elements });
}
export {
  CodeLogView
};
