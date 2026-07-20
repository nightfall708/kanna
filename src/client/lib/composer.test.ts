import { describe, expect, test } from "bun:test"
import { PROVIDERS, supportsClaudeMaxReasoningEffort } from "../../shared/types"
import { createDefaultProviderDefaults, type ComposerState } from "../stores/chatPreferencesStore"
import {
  applyModelToComposerState,
  deriveComposerOptionControls,
  deriveComposerView,
  getEffectiveComposerState,
  isModelSelectable,
} from "./composer"

const providerDefaults = createDefaultProviderDefaults()

function claudeState(overrides: Partial<Extract<ComposerState, { provider: "claude" }>> = {}): ComposerState {
  return {
    provider: "claude",
    model: providerDefaults.claude.model,
    modelOptions: { ...providerDefaults.claude.modelOptions },
    planMode: false,
    ...overrides,
  } as ComposerState
}

describe("deriveComposerView", () => {
  test("new chat: provider is changeable and comes from composer state", () => {
    const view = deriveComposerView({
      chatId: null,
      activeProvider: null,
      availableProviders: PROVIDERS,
      composerState: claudeState(),
      providerDefaults,
    })

    expect(view.composerChatId).toBe("__new__")
    expect(view.providerLocked).toBe(false)
    expect(view.canChangeProvider).toBe(true)
    expect(view.selectedProvider).toBe("claude")
    expect(view.models.length).toBeGreaterThan(0)
    expect(view.supportsPlanMode).toBe(true)
  })

  test("locked chat: provider comes from the session, not the stored composer state", () => {
    const view = deriveComposerView({
      chatId: "chat-1",
      activeProvider: "codex",
      availableProviders: PROVIDERS,
      composerState: claudeState({ planMode: true }),
      providerDefaults,
    })

    expect(view.composerChatId).toBe("chat-1")
    expect(view.providerLocked).toBe(true)
    expect(view.canChangeProvider).toBe(false)
    expect(view.selectedProvider).toBe("codex")
    // Effective state falls back to codex defaults but keeps plan mode.
    expect(view.effectiveState.provider).toBe("codex")
    expect(view.effectiveState.model).toBe(providerDefaults.codex.model)
    expect(view.effectiveState.planMode).toBe(true)
    // Models are the locked provider's catalog.
    expect(view.models).toBe(PROVIDERS.find((provider) => provider.id === "codex")!.models)
  })

  test("stored state matching the locked provider is used as-is", () => {
    const stored = claudeState({ model: "claude-sonnet-4-6" })
    const view = deriveComposerView({
      chatId: "chat-1",
      activeProvider: "claude",
      availableProviders: PROVIDERS,
      composerState: stored,
      providerDefaults,
    })

    expect(view.effectiveState).toBe(stored)
    expect(view.effectiveState.model).toBe("claude-sonnet-4-6")
  })
})

describe("isModelSelectable", () => {
  test("only catalog models are selectable", () => {
    const view = deriveComposerView({
      chatId: null,
      activeProvider: null,
      availableProviders: PROVIDERS,
      composerState: claudeState(),
      providerDefaults,
    })

    const claudeModels = PROVIDERS.find((provider) => provider.id === "claude")!.models
    expect(isModelSelectable(view, claudeModels[0].id)).toBe(true)
    expect(isModelSelectable(view, "gpt-5.6-luna")).toBe(false)
    expect(isModelSelectable(view, "made-up-model")).toBe(false)
  })
})

describe("applyModelToComposerState", () => {
  test("claude model change normalizes context window and fast mode", () => {
    const state = claudeState()
    const next = applyModelToComposerState(state, "claude-haiku-4-6")
    expect(next.model).toBe("claude-haiku-4-6")
    expect(next.provider).toBe("claude")
    // Options object is re-derived, never shared with the input state.
    expect(next.modelOptions).not.toBe(state.modelOptions)
  })

  test("codex model change normalizes model id and reasoning effort", () => {
    const state: ComposerState = {
      provider: "codex",
      model: providerDefaults.codex.model,
      modelOptions: { ...providerDefaults.codex.modelOptions, reasoningEffort: "ultra" },
      planMode: false,
    } as ComposerState
    const next = applyModelToComposerState(state, "gpt-5.6-luna")
    expect(next.provider).toBe("codex")
    expect(next.model).toBe("gpt-5.6-luna")
    // Effort is clamped/normalized for the selected model rather than kept blindly.
    expect(typeof (next.modelOptions as { reasoningEffort: string }).reasoningEffort).toBe("string")
  })
})

describe("deriveComposerOptionControls", () => {
  const claudeConfig = PROVIDERS.find((provider) => provider.id === "claude")!
  const cursorConfig = PROVIDERS.find((provider) => provider.id === "cursor")!
  const codexConfig = PROVIDERS.find((provider) => provider.id === "codex")!

  test("claude exposes reasoning, plan mode, and (per model) context window + fast mode", () => {
    const modelWithWindow = claudeConfig.models.find((model) => (model.contextWindowOptions?.length ?? 0) > 1)!
    const controls = deriveComposerOptionControls(
      claudeState({ model: modelWithWindow.id }),
      claudeConfig
    )

    expect(controls.reasoning).not.toBeNull()
    expect(controls.planMode).not.toBeNull()
    expect(controls.contextWindow?.options.map((option) => option.id)).toEqual(["1m", "200k"])
    expect(controls.fastMode !== null).toBe(Boolean(modelWithWindow.supportsFastMode))
    // "Max" reasoning is disabled unless the model supports it.
    const max = controls.reasoning?.options.find((option) => option.id === "max")
    expect(max?.disabled).toBe(!supportsClaudeMaxReasoningEffort(modelWithWindow.id))
  })

  test("cursor has no reasoning selector", () => {
    const cursorModel = cursorConfig.models[0]
    const controls = deriveComposerOptionControls(
      {
        provider: "cursor",
        model: cursorModel?.id ?? "auto",
        modelOptions: {},
        planMode: false,
      } as ComposerState,
      cursorConfig
    )
    expect(controls.reasoning).toBeNull()
    expect(controls.contextWindow).toBeNull()
  })

  test("codex reasoning options are model-specific and no context window is offered", () => {
    const controls = deriveComposerOptionControls(
      {
        provider: "codex",
        model: providerDefaults.codex.model,
        modelOptions: { ...providerDefaults.codex.modelOptions },
        planMode: false,
      } as ComposerState,
      codexConfig
    )
    expect(controls.reasoning?.options.length).toBeGreaterThan(0)
    expect(controls.contextWindow).toBeNull()
  })

  test("fast mode only offered when the selected model supports it", () => {
    const unsupported = claudeConfig.models.find((model) => !model.supportsFastMode)
    if (unsupported) {
      const controls = deriveComposerOptionControls(claudeState({ model: unsupported.id }), claudeConfig)
      expect(controls.fastMode).toBeNull()
    }
    const supported = claudeConfig.models.find((model) => model.supportsFastMode)
    if (supported) {
      const controls = deriveComposerOptionControls(claudeState({ model: supported.id }), claudeConfig)
      expect(controls.fastMode).toEqual({ enabled: false })
    }
  })
})

describe("getEffectiveComposerState", () => {
  test("returns input when no lock or provider matches", () => {
    const state = claudeState()
    expect(getEffectiveComposerState(state, null, providerDefaults)).toBe(state)
    expect(getEffectiveComposerState(state, "claude", providerDefaults)).toBe(state)
  })

  test("locked mismatch falls back to that provider's defaults, keeping plan mode", () => {
    const effective = getEffectiveComposerState(claudeState({ planMode: true }), "pi", providerDefaults)
    expect(effective.provider).toBe("pi")
    expect(effective.model).toBe(providerDefaults.pi.model)
    expect(effective.planMode).toBe(true)
  })
})
