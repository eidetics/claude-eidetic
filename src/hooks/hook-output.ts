/**
 * Strongly typed Claude Code hook output schemas.
 *
 * Every hook must output JSON to stdout matching these types.
 * See: https://docs.anthropic.com/en/docs/claude-code/hooks
 *
 * Base fields (available for ALL hooks):
 *   continue, suppressOutput, stopReason, decision, reason, systemMessage
 *
 * hookSpecificOutput varies by event:
 *   PreToolUse  → permissionDecision, permissionDecisionReason, updatedInput
 *   UserPromptSubmit → additionalContext (required)
 *   PostToolUse → additionalContext (optional)
 *   SessionStart → additionalContext (optional)
 *   PreCompact / SessionEnd / Stop → no hookSpecificOutput defined
 */

// ── Base fields shared by all hook events ─────────────────────────────

interface HookOutputBase {
  continue?: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  decision?: 'approve' | 'block';
  reason?: string;
  systemMessage?: string;
}

// ── Event-specific output types ───────────────────────────────────────

export interface PreToolUseOutput extends HookOutputBase {
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse';
    permissionDecision?: 'allow' | 'deny' | 'ask';
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
  };
}

export interface UserPromptSubmitOutput extends HookOutputBase {
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit';
    additionalContext: string;
  };
}

export interface PostToolUseOutput extends HookOutputBase {
  hookSpecificOutput?: {
    hookEventName: 'PostToolUse';
    additionalContext?: string;
  };
}

export interface SessionStartOutput extends HookOutputBase {
  hookSpecificOutput?: {
    hookEventName: 'SessionStart';
    additionalContext?: string;
  };
}

/** PreCompact, SessionEnd, Stop — no hookSpecificOutput defined. */
export type SimpleHookOutput = HookOutputBase;

// ── Union of all valid outputs ────────────────────────────────────────

export type HookOutput =
  | PreToolUseOutput
  | UserPromptSubmitOutput
  | PostToolUseOutput
  | SessionStartOutput
  | SimpleHookOutput;

// ── Helper to write output to stdout ──────────────────────────────────

export function writeHookOutput(output: HookOutput): void {
  process.stdout.write(JSON.stringify(output));
}
