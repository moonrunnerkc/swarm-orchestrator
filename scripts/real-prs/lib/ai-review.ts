// AI-generated review bodies posted under a human account. A model-written
// review is not a maintainer complaint even when a human's login carries it:
// round one of the delegated corpus review rejected apache/camel#24716 (an
// APPROVED review body marked "Claude Code review on behalf of @gnodet") and
// alibaba/fastjson2#7675 (a qwen review-suggestion table posted under
// wenshao's account) on exactly this ground. Bot ACCOUNTS are already dropped
// by isBotAuthor; this catches machine-generated BODIES under human accounts.

/**
 * Markers of machine-generated review output. Each is anchored on the tool's
 * own self-identification, never on writing style, so a human complaint that
 * merely mentions an AI tool ("this looks like Claude Code output") passes.
 */
const AI_REVIEW_BODY_MARKERS: readonly RegExp[] = [
  // The on-behalf-of delegation line the Claude Code (and sibling CLI) review
  // action emits, e.g. "Claude Code review on behalf of @gnodet".
  /\b(?:claude code|qwen code|gemini code assist|copilot|codex|devin|openhands|cursor|aider)\s+review\s+on\s+behalf\s+of\b/i,
  // A model naming itself and the CLI review verb that produced the table,
  // e.g. "qwen3.7-max via Qwen Code /review".
  /\b(?:claude|qwen|gemini|gpt)[\w.-]*\s+via\s+(?:claude|qwen|gemini|copilot|codex)\s+code\b/i,
  // Hidden HTML anchors the review tools embed around their summary tables,
  // e.g. <!-- qwen-review-suggestion-summary -->.
  /<!--\s*[a-z0-9-]*review-suggestion[a-z0-9-]*\s*-->/i,
  // The standard Claude Code attribution trailer.
  /generated with \[?claude code\]?/i,
];

/**
 * Whether a conversation body is recognizable AI-generated review output
 * (delegated on-behalf-of reviews, model-produced review tables) rather than
 * something a human typed. Matches only the tools' own self-identification
 * markers, so human prose about AI tools does not trip it.
 *
 * @param body the comment or review body to test.
 * @returns true when the body carries an AI-review self-identification marker.
 */
export function isAiGeneratedReviewBody(body: string): boolean {
  return AI_REVIEW_BODY_MARKERS.some((re) => re.test(body));
}
