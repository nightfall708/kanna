import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent"
import type { Model } from "@mariozechner/pi-ai"
import type { ContextWindowUsageSnapshot, PiReasoningEffort } from "../shared/types"
import { getDataRootDir } from "../shared/branding"
import { normalizeToolCall } from "../shared/tools"
import type { HarnessEvent, HarnessTurn } from "./harness-types"
import { AsyncQueue } from "./async-queue"
import { readLlmProviderSnapshot } from "./llm-provider"
import { timestamped } from "./transcript"

/**
 * Adapter for the pi coding agent (@mariozechner/pi-coding-agent), driven
 * in-process through its SDK — the same way the Claude Agent SDK harness works,
 * rather than shelling out to a user-installed CLI.
 *
 * This is deliberately an opinionated, bundled setup:
 *   - Only OpenRouter is supported. The API key comes from Kanna's settings
 *     (the LLM provider config) with the OPENROUTER_API_KEY env var as fallback.
 *   - Any OpenRouter model id works: known models resolve from pi's catalog,
 *     unknown ids get a synthesized OpenRouter model definition.
 *   - Reasoning uses pi's standardized thinking levels
 *     (off/minimal/low/medium/high/xhigh), mapped by pi-ai to OpenRouter's
 *     `reasoning: { effort }` parameter.
 *   - The user's local pi installation (~/.pi) is never read: state lives under
 *     Kanna's data root, credentials stay in memory, and extension/skill/theme
 *     discovery is disabled. Project AGENTS.md context files still apply.
 *
 * Pi's built-in tool set (read, bash, edit, write, grep, find, ls) is mapped
 * one-to-one onto Kanna's existing normalized tools via Claude-style names
 * (Read, Bash, Edit, Write, Grep, Glob), so everything renders natively.
 */

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

export const PI_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const

/** Claude-style tool names surfaced in system_init for the UI. */
export const PI_DISPLAY_TOOLS = ["Read", "Bash", "Edit", "Write", "Grep", "Glob"]

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/**
 * Translate a pi tool call into the Claude-style tool name + snake_case input
 * that `normalizeToolCall` understands. Every one of pi's seven built-in tools
 * maps onto an existing Kanna tool kind:
 *
 *   read  → Read (read_file)      bash → Bash (bash)
 *   edit  → Edit (edit_file)      write → Write (write_file)
 *   grep  → Grep (grep)           find → Glob (glob)
 *   ls    → Glob (glob, `<path>/*` pattern)
 */
export function translatePiTool(
  rawName: string,
  args: Record<string, unknown>
): { toolName: string; input: Record<string, unknown> } {
  switch (rawName) {
    case "read":
      return {
        toolName: "Read",
        input: { file_path: args.path ?? "", offset: args.offset, limit: args.limit },
      }
    case "bash":
      return {
        toolName: "Bash",
        input: {
          command: args.command ?? "",
          // pi's bash timeout is in seconds; Kanna's normalized input is ms.
          timeout: typeof args.timeout === "number" ? args.timeout * 1000 : undefined,
        },
      }
    case "edit": {
      // pi's edit applies a list of {oldText, newText} replacements in one call.
      // Kanna's edit_file renders a single old/new pair, so multi-edit calls are
      // joined — each replacement still shows as its own hunk in the diff view.
      const edits = Array.isArray(args.edits) ? args.edits.map(asRecord) : []
      return {
        toolName: "Edit",
        input: {
          file_path: args.path ?? "",
          old_string: edits.map((edit) => edit.oldText ?? "").join("\n"),
          new_string: edits.map((edit) => edit.newText ?? "").join("\n"),
        },
      }
    }
    case "write":
      return {
        toolName: "Write",
        input: { file_path: args.path ?? "", content: args.content ?? "" },
      }
    case "grep":
      return {
        toolName: "Grep",
        input: {
          pattern: args.pattern ?? "",
          path: args.path,
          glob: args.glob,
          "-i": args.ignoreCase,
          "-C": args.context,
          head_limit: args.limit,
        },
      }
    case "find":
      return {
        toolName: "Glob",
        input: { pattern: args.pattern ?? "", path: args.path },
      }
    case "ls": {
      const dirPath = typeof args.path === "string" && args.path.length > 0 ? args.path : "."
      return {
        toolName: "Glob",
        input: { pattern: `${dirPath.replace(/\/$/, "")}/*`, path: args.path },
      }
    }
    default:
      // Unmapped tools still render via unknown_tool.
      return { toolName: rawName, input: args }
  }
}

/**
 * Extract renderable content from a pi AgentToolResult ({ content: blocks[] }).
 * Text-only results collapse to a plain string; results with images keep the
 * block structure that `hydrateToolResult` understands.
 */
export function extractPiToolResultContent(result: unknown): unknown {
  const record = asRecord(result)
  const blocks = Array.isArray(record.content) ? record.content : null
  if (!blocks) {
    return typeof result === "string" ? result : record.output ?? result ?? ""
  }

  const hasImage = blocks.some((block) => asRecord(block).type === "image")
  if (hasImage) {
    return { content: blocks }
  }

  return blocks
    .map((block) => {
      const blockRecord = asRecord(block)
      return blockRecord.type === "text" && typeof blockRecord.text === "string" ? blockRecord.text : ""
    })
    .join("")
}

/** Map pi's per-message usage into Kanna's context-window snapshot. */
export function normalizePiUsage(usage: unknown, contextWindow?: number): ContextWindowUsageSnapshot | null {
  const record = asRecord(usage)
  const input = typeof record.input === "number" ? record.input : 0
  const output = typeof record.output === "number" ? record.output : 0
  const cacheRead = typeof record.cacheRead === "number" ? record.cacheRead : 0
  const cacheWrite = typeof record.cacheWrite === "number" ? record.cacheWrite : 0

  const inputTokens = input + cacheRead + cacheWrite
  const usedTokens = inputTokens + output
  if (usedTokens <= 0) return null

  return {
    usedTokens,
    inputTokens,
    ...(cacheRead > 0 ? { cachedInputTokens: cacheRead } : {}),
    ...(output > 0 ? { outputTokens: output } : {}),
    lastUsedTokens: usedTokens,
    lastInputTokens: inputTokens,
    ...(cacheRead > 0 ? { lastCachedInputTokens: cacheRead } : {}),
    ...(output > 0 ? { lastOutputTokens: output } : {}),
    ...(contextWindow && contextWindow > 0 ? { maxTokens: contextWindow } : {}),
    compactsAutomatically: true,
  }
}

/**
 * Build a Model definition for an arbitrary OpenRouter model id that isn't in
 * pi's bundled catalog. Reasoning is enabled — OpenRouter ignores the reasoning
 * parameter for models that don't support it, and pi clamps levels per model.
 */
export function buildOpenRouterModel(modelId: string): Model<"openai-completions"> {
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: OPENROUTER_BASE_URL,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 32_000,
    compat: { thinkingFormat: "openrouter" },
  }
}

/**
 * Resolve the OpenRouter API key for pi turns: the key from Kanna's LLM
 * provider settings (when set to OpenRouter) wins, then the OPENROUTER_API_KEY
 * environment variable.
 */
export async function resolveOpenRouterApiKey(): Promise<string | null> {
  try {
    const snapshot = await readLlmProviderSnapshot()
    if (snapshot.provider === "openrouter" && snapshot.apiKey) {
      return snapshot.apiKey
    }
  } catch {
    // fall through to the environment variable
  }
  const envKey = process.env.OPENROUTER_API_KEY?.trim()
  return envKey || null
}

export const MISSING_OPENROUTER_KEY_MESSAGE =
  "Pi needs an OpenRouter API key. Set the LLM provider to OpenRouter in Settings and add your key, or export OPENROUTER_API_KEY."

export interface StartPiTurnArgs {
  chatId: string
  cwd: string
  content: string
  /** OpenRouter model id, e.g. "moonshotai/kimi-k2.6" or any arbitrary id. */
  model: string
  effort: PiReasoningEffort
  /** Previous pi session file path to resume, if any. */
  sessionToken: string | null
  forkSession: boolean
  /** OpenRouter API key from Kanna settings (or env fallback). Null surfaces an error turn. */
  apiKey: string | null
}

interface PiChatSession {
  session: AgentSession
  authStorage: AuthStorage
  modelRegistry: ModelRegistry
  cwd: string
  model: string
  effort: PiReasoningEffort
}

/** A turn that failed before the agent could start (missing key, bad session file). */
function failedPiTurn(message: string): HarnessTurn {
  const queue = new AsyncQueue<HarnessEvent>()
  queue.push({
    type: "transcript",
    entry: timestamped({
      kind: "result",
      subtype: "error",
      isError: true,
      durationMs: 0,
      result: message,
    }),
  })
  queue.finish()
  return {
    provider: "pi",
    stream: queue,
    interrupt: async () => {},
    close: () => {},
  }
}

export class PiAgentManager {
  private readonly sessions = new Map<string, PiChatSession>()
  private readonly agentDir: string
  private readonly sessionsDir: string

  constructor(args: { dataDir?: string } = {}) {
    const dataDir = args.dataDir ?? path.join(getDataRootDir(homedir()), "pi")
    this.agentDir = path.join(dataDir, "agent")
    this.sessionsDir = path.join(dataDir, "sessions")
  }

  closeChat(chatId: string) {
    const existing = this.sessions.get(chatId)
    if (!existing) return
    this.sessions.delete(chatId)
    existing.session.dispose()
  }

  dispose() {
    for (const chatId of [...this.sessions.keys()]) {
      this.closeChat(chatId)
    }
  }

  private resolveModel(registry: ModelRegistry, modelId: string): Model<any> {
    return registry.find("openrouter", modelId) ?? buildOpenRouterModel(modelId)
  }

  private async openSession(args: StartPiTurnArgs & { apiKey: string }): Promise<PiChatSession> {
    const existing = this.sessions.get(args.chatId)
    if (existing && existing.cwd === args.cwd && !args.forkSession) {
      existing.authStorage.setRuntimeApiKey("openrouter", args.apiKey)
      if (existing.model !== args.model) {
        await existing.session.setModel(this.resolveModel(existing.modelRegistry, args.model))
        existing.model = args.model
      }
      if (existing.effort !== args.effort) {
        existing.session.setThinkingLevel(args.effort)
        existing.effort = args.effort
      }
      return existing
    }

    if (existing) {
      this.sessions.delete(args.chatId)
      existing.session.dispose()
    }

    // All state is Kanna-owned: in-memory credentials/settings, sessions under
    // Kanna's data root, and no discovery of the user's ~/.pi setup.
    const authStorage = AuthStorage.inMemory()
    authStorage.setRuntimeApiKey("openrouter", args.apiKey)
    const modelRegistry = ModelRegistry.inMemory(authStorage)
    const settingsManager = SettingsManager.inMemory()

    const resourceLoader = new DefaultResourceLoader({
      cwd: args.cwd,
      agentDir: this.agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    })
    await resourceLoader.reload()

    const sessionManager = args.forkSession && args.sessionToken && existsSync(args.sessionToken)
      ? SessionManager.forkFrom(args.sessionToken, args.cwd, this.sessionsDir)
      : args.sessionToken && existsSync(args.sessionToken)
        ? SessionManager.open(args.sessionToken, this.sessionsDir, args.cwd)
        : SessionManager.create(args.cwd, this.sessionsDir)

    const { session } = await createAgentSession({
      cwd: args.cwd,
      agentDir: this.agentDir,
      authStorage,
      modelRegistry,
      settingsManager,
      sessionManager,
      resourceLoader,
      model: this.resolveModel(modelRegistry, args.model),
      thinkingLevel: args.effort,
      tools: [...PI_TOOL_NAMES],
    })

    const chatSession: PiChatSession = {
      session,
      authStorage,
      modelRegistry,
      cwd: args.cwd,
      model: args.model,
      effort: args.effort,
    }
    this.sessions.set(args.chatId, chatSession)
    return chatSession
  }

  async startTurn(args: StartPiTurnArgs): Promise<HarnessTurn> {
    if (!args.apiKey) {
      return failedPiTurn(MISSING_OPENROUTER_KEY_MESSAGE)
    }

    let chatSession: PiChatSession
    try {
      chatSession = await this.openSession({ ...args, apiKey: args.apiKey })
    } catch (error) {
      return failedPiTurn(error instanceof Error ? error.message : String(error))
    }
    const session = chatSession.session
    const queue = new AsyncQueue<HarnessEvent>()
    const startedAt = Date.now()

    let finished = false
    let turnCostUsd = 0
    let lastError: string | null = null
    let aborted = false

    const pushSessionToken = () => {
      if (session.sessionFile) {
        queue.push({ type: "session_token", sessionToken: session.sessionFile })
      }
    }

    const finalize = (result: { isError: boolean; message: string; cancelled?: boolean }) => {
      if (finished) return
      finished = true
      unsubscribe()
      pushSessionToken()
      if (!result.cancelled) {
        queue.push({
          type: "transcript",
          entry: timestamped({
            kind: "result",
            subtype: result.isError ? "error" : "success",
            isError: result.isError,
            durationMs: Date.now() - startedAt,
            result: result.message,
            ...(turnCostUsd > 0 ? { costUsd: turnCostUsd } : {}),
          }),
        })
      }
      queue.finish()
    }

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      switch (event.type) {
        case "message_end": {
          const message = asRecord(event.message)
          if (message.role !== "assistant") return

          const usageRecord = asRecord(message.usage)
          if (typeof usageRecord.cost === "object") {
            const total = asRecord(usageRecord.cost).total
            if (typeof total === "number") turnCostUsd += total
          }
          const usage = normalizePiUsage(message.usage, session.model?.contextWindow)
          if (usage) {
            queue.push({
              type: "transcript",
              entry: timestamped({ kind: "context_window_updated", usage }),
            })
          }

          if (message.stopReason === "error") {
            lastError = typeof message.errorMessage === "string" && message.errorMessage
              ? message.errorMessage
              : "Pi turn failed"
          }
          if (message.stopReason === "aborted") {
            aborted = true
          }

          const text = Array.isArray(message.content)
            ? message.content
              .map((block) => {
                const blockRecord = asRecord(block)
                return blockRecord.type === "text" && typeof blockRecord.text === "string" ? blockRecord.text : ""
              })
              .join("")
            : ""
          if (text.trim()) {
            queue.push({ type: "transcript", entry: timestamped({ kind: "assistant_text", text }) })
          }
          return
        }

        case "tool_execution_start": {
          const { toolName, input } = translatePiTool(event.toolName, asRecord(event.args))
          queue.push({
            type: "transcript",
            entry: timestamped({
              kind: "tool_call",
              tool: normalizeToolCall({ toolName, toolId: event.toolCallId, input }),
            }),
          })
          return
        }

        case "tool_execution_end": {
          queue.push({
            type: "transcript",
            entry: timestamped({
              kind: "tool_result",
              toolId: event.toolCallId,
              content: extractPiToolResultContent(event.result),
              isError: event.isError,
            }),
          })
          return
        }

        default:
          return
      }
    })

    queue.push({
      type: "transcript",
      entry: timestamped({
        kind: "system_init",
        provider: "pi",
        model: args.model,
        tools: [...PI_DISPLAY_TOOLS],
        agents: [],
        slashCommands: [],
        mcpServers: [],
      }),
    })
    pushSessionToken()

    void session.prompt(args.content)
      .then(() => {
        if (aborted) {
          finalize({ isError: false, message: "", cancelled: true })
        } else if (lastError) {
          finalize({ isError: true, message: lastError })
        } else {
          finalize({ isError: false, message: "" })
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        finalize({ isError: true, message })
      })

    return {
      provider: "pi",
      stream: queue,
      interrupt: async () => {
        await session.abort()
      },
      // The AgentSession stays alive across turns (it's reused by the next
      // startTurn and torn down in closeChat); close only ends this turn's stream.
      close: () => {
        finalize({ isError: false, message: "", cancelled: true })
      },
    }
  }
}
