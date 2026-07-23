// MCP server `instructions` — injected into every connected agent's system
// context by MCP-aware harnesses (Claude Code, etc.) at initialize time.
// This is the always-on distillation of skills/conventions/brain-first.md;
// keep the two in sync. The skill doc stays the full convention (entity page
// layout, write rules, sync); this string only carries what every session
// must know unprompted: that the brain exists, and to consult it first.
export const MCP_INSTRUCTIONS = `gbrain is the shared institutional brain: pages on people, companies, ventures, projects, decisions, meetings, and facts — with links, timelines, and hybrid search.

BRAIN-FIRST CONVENTION: before answering anything about entities, projects, decisions, commitments, or history — and before drafting communications on the user's behalf (email replies, messages, documents) — look it up here first.

Lookup chain, in order:
1. \`search\` — keyword, fast, zero API cost
2. \`query\` — hybrid semantic, if search is thin
3. \`get_page\` — full compiled truth for the best hit
Reach for external sources only after steps 1-2 return nothing useful. Score > 0.5 = use it.

For connected context use \`get_backlinks\` / \`get_links\`; \`get_timeline\` for chronology.

The brain records the user's own statements and decisions — when it contradicts an assumption, the brain wins. If the brain is unreachable, proceed and note that in your output. Never write to the brain unless the user explicitly asks.`;
