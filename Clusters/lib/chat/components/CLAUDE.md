# lib/chat/components/

JSX components for the chat UI. Compiled to `.js` by `npm run build` (esbuild).

## Tool Display Names

`tool-names.js` auto-generates display names from the tool's snake_case name (split on `_`, capitalize each word). No map to maintain — adding a new tool automatically gets a display name.

This file is **UI-only** — it controls display text, not which tools are available. Tool-to-agent assignment lives in `lib/ai/agent.js`.
