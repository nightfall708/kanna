import { useMemo, useState, type ComponentType, type ReactNode, type SVGProps } from "react"
import { Box, Brain, Gauge, ListTodo, LockOpen, Plus, Search, SquareMenu, SquareMinus } from "lucide-react"
import {
  resolveModelLabel,
  type AgentProvider,
  type ClaudeContextWindow,
  type ClaudeModelOptions,
  type ClaudeReasoningEffort,
  type CodexModelOptions,
  type CodexReasoningEffort,
  type CursorModelOptions,
  type PiModelOptions,
  type PiReasoningEffort,
  type ProviderCatalogEntry,
  type ProviderModelOption,
} from "../../../shared/types"
import { deriveComposerOptionControls } from "../../lib/composer"
import { cn } from "../../lib/utils"
import type { ComposerState } from "../../stores/chatPreferencesStore"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

function AnthropicIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="currentColor"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      {...props}
    >
      <path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z" />
    </svg>
  )
}

function OpenAIIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 158.7128 157.296"
      fill="currentColor"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      {...props}
    >
      <path d="M60.8734 57.2556V42.3124c0-1.2586.4722-2.2029 1.5728-2.8314l30.0443-17.3023c4.0899-2.3593 8.9662-3.4599 13.9988-3.4599 18.8759 0 30.8307 14.6289 30.8307 30.2006 0 1.1007 0 2.3593-.158 3.6178l-31.1446-18.2467c-1.8872-1.1006-3.7754-1.1006-5.6629 0L60.8734 57.2556Zm70.1542 58.2005V79.7487c0-2.2028-.9446-3.7756-2.8318-4.8763l-39.481-22.9651 12.8982-7.3934c1.1007-.6285 2.0453-.6285 3.1458 0l30.0441 17.3024c8.6523 5.0341 14.4708 15.7296 14.4708 26.1107 0 11.9539-7.0769 22.965-18.2461 27.527ZM51.593 83.9964l-12.8982-7.5497c-1.1007-.6285-1.5728-1.5728-1.5728-2.8314V39.0105c0-16.8303 12.8982-29.5722 30.3585-29.5722 6.607 0 12.7403 2.2029 17.9324 6.1349l-30.987 17.9324c-1.8871 1.1007-2.8314 2.6735-2.8314 4.8764v45.6159ZM79.3562 100.0403 60.8733 89.6592V67.6383l18.4829-10.3811 18.4812 10.3811v22.0209l-18.4812 10.3811Zm11.8757 47.8188c-6.607 0-12.7403-2.2031-17.9324-6.1344l30.9866-17.9333c1.8872-1.1005 2.8318-2.6728 2.8318-4.8759v-45.616l13.0564 7.5498c1.1005.6285 1.5723 1.5728 1.5723 2.8314v34.6051c0 16.8297-13.0564 29.5723-30.5147 29.5723ZM53.9522 112.7822 23.9079 95.4798c-8.652-5.0343-14.471-15.7296-14.471-26.1107 0-12.1119 7.2356-22.9652 18.403-27.5272v35.8634c0 2.2028.9443 3.7756 2.8314 4.8763l39.3248 22.8068-12.8982 7.3938c-1.1007.6287-2.045.6287-3.1456 0ZM52.2229 138.5791c-17.7745 0-30.8306-13.3713-30.8306-29.8871 0-1.2585.1578-2.5169.3143-3.7754l30.987 17.9323c1.8871 1.1005 3.7757 1.1005 5.6628 0l39.4811-22.807v14.9435c0 1.2585-.4721 2.2021-1.5728 2.8308l-30.0443 17.3025c-4.0898 2.359-8.9662 3.4605-13.9989 3.4605h.0014ZM91.2319 157.296c19.0327 0 34.9188-13.5272 38.5383-31.4594 17.6164-4.562 28.9425-21.0779 28.9425-37.908 0-11.0112-4.719-21.7066-13.2133-29.4143.7867-3.3035 1.2595-6.607 1.2595-9.909 0-22.4929-18.2471-39.3247-39.3251-39.3247-4.2461 0-8.3363.6285-12.4262 2.045-7.0792-6.9213-16.8318-11.3254-27.5271-11.3254-19.0331 0-34.9191 13.5268-38.5384 31.4591C11.3255 36.0212 0 52.5373 0 69.3675c0 11.0112 4.7184 21.7065 13.2125 29.4142-.7865 3.3035-1.2586 6.6067-1.2586 9.9092 0 22.4923 18.2466 39.3241 39.3248 39.3241 4.2462 0 8.3362-.6277 12.426-2.0441 7.0776 6.921 16.8302 11.3251 27.5271 11.3251Z" />
    </svg>
  )
}

function CursorIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 747 851"
      fill="currentColor"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      {...props}
    >
      <path d="M731.545 201.413L390.888 4.73778C379.949 -1.57926 366.452 -1.57926 355.513 4.73778L14.8731 201.413C5.67749 206.723 0.00012207 216.542 0.00012207 227.177V623.776C0.00012207 634.394 5.67749 644.23 14.8731 649.539L355.529 846.214C366.468 852.532 379.966 852.532 390.905 846.214L731.56 649.539C740.756 644.23 746.434 634.409 746.434 623.776V227.177C746.434 216.558 740.756 206.723 731.56 201.413H731.545ZM710.147 243.074L381.293 812.663C379.07 816.501 373.201 814.933 373.201 810.487V437.526C373.201 430.074 369.218 423.18 362.757 419.438L39.7735 232.966C35.9353 230.744 37.5026 224.874 41.9484 224.874H699.655C708.996 224.874 714.833 234.997 710.162 243.09H710.147V243.074Z" />
    </svg>
  )
}

function PiIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="-10 -10 84 84"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0 0H47.9997V31.9993H31.9993V47.9997H16.0003V64H0V0ZM16.0003 16.0003V31.9993H31.9993V16.0003H16.0003Z"
      />
      <path d="M47.9997 31.9993H64V64H47.9997V31.9993Z" />
    </svg>
  )
}

export const PROVIDER_ICONS: Record<AgentProvider, IconComponent> = {
  claude: AnthropicIcon,
  codex: OpenAIIcon,
  cursor: CursorIcon,
  pi: PiIcon,
}

/** Flush table-like row inside an InputPopover: flat edges, divider-separated. */
export function PopoverMenuItem({
  onClick,
  selected,
  icon,
  label,
  description,
  disabled,
}: {
  onClick: () => void
  selected: boolean
  icon: React.ReactNode
  label: React.ReactNode
  description?: string
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-2 text-left [&>svg]:shrink-0 px-3 py-2 transition-colors",
        selected ? "bg-muted" : "hover:bg-muted/50",
        disabled && "opacity-40 cursor-not-allowed"
      )}
    >
      {icon}
      <div>
        <div className="text-sm font-medium">{label}</div>
        {description ? <div className="text-xs text-muted-foreground">{description}</div> : null}
      </div>
    </button>
  )
}

export function InputPopover({
  trigger,
  triggerClassName,
  disabled = false,
  children,
}: {
  trigger: React.ReactNode
  triggerClassName?: string
  disabled?: boolean
  children: React.ReactNode | ((close: () => void) => React.ReactNode)
}) {
  const [open, setOpen] = useState(false)

  if (disabled) {
    return (
      <button
        disabled
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 text-sm rounded-md text-muted-foreground [&>svg]:shrink-0 opacity-70 cursor-default [&>span]:whitespace-nowrap",
          triggerClassName
        )}
      >
        {trigger}
      </button>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 text-sm rounded-md transition-colors text-muted-foreground [&>svg]:shrink-0 [&>span]:whitespace-nowrap",
            "hover:bg-muted/50",
            triggerClassName
          )}
        >
          {trigger}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-64 overflow-hidden p-0">
        {/* Runtime-discovered model lists (e.g. Cursor) can be long — scroll instead of overflowing the viewport. */}
        <div className="max-h-80 overflow-y-auto divide-y divide-border/60">
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export type ModelOptionChange =
  | { type: "claudeReasoningEffort"; effort: ClaudeReasoningEffort }
  | { type: "contextWindow"; contextWindow: ClaudeContextWindow }
  | { type: "codexReasoningEffort"; effort: CodexReasoningEffort }
  | { type: "piReasoningEffort"; effort: PiReasoningEffort }
  | { type: "fastMode"; fastMode: boolean }

/**
 * Model picker body with an optional filter box. The box is shown only for long
 * lists (e.g. the runtime-discovered Cursor catalog) so short provider lists
 * stay a plain menu. Rendered inside InputPopover's flush `divide-y` list.
 */
function ModelPickerList({
  models,
  selectedModel,
  onSelect,
  renderLabel,
  footer,
  searchThreshold = 12,
}: {
  models: ProviderModelOption[]
  selectedModel: string
  onSelect: (modelId: string) => void
  renderLabel?: (candidate: ProviderModelOption) => ReactNode
  footer?: ReactNode
  searchThreshold?: number
}) {
  const [query, setQuery] = useState("")
  const showSearch = models.length > searchThreshold
  const trimmed = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!trimmed) return models
    return models.filter(
      (model) => model.id.toLowerCase().includes(trimmed) || model.label.toLowerCase().includes(trimmed),
    )
  }, [models, trimmed])

  return (
    <>
      {showSearch ? (
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-popover px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="Filter models…"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      ) : null}
      {filtered.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">No matching models</div>
      ) : (
        filtered.map((candidate) => (
          <PopoverMenuItem
            key={candidate.id}
            onClick={() => onSelect(candidate.id)}
            selected={selectedModel === candidate.id}
            icon={<Box className="h-4 w-4 text-muted-foreground" />}
            label={renderLabel ? renderLabel(candidate) : candidate.label}
          />
        ))
      )}
      {footer}
    </>
  )
}

interface ChatPreferenceControlsProps {
  availableProviders: ProviderCatalogEntry[]
  selectedProvider: AgentProvider
  showProviderPicker?: boolean
  providerLocked?: boolean
  /** A harness switch is staged for this chat and applies on the next send. */
  providerSwitchPending?: boolean
  model: string
  modelOptions: ClaudeModelOptions | CodexModelOptions | CursorModelOptions | PiModelOptions
  onProviderChange?: (provider: AgentProvider) => void
  onModelChange: (provider: AgentProvider, model: string) => void
  onModelOptionChange: (change: ModelOptionChange) => void
  /** Opens the Default Models dialog from the pi model picker's "Add models…" row. */
  onEditModels?: () => void
  planMode?: boolean
  onPlanModeChange?: (planMode: boolean) => void
  includePlanMode?: boolean
  className?: string
}

export function ChatPreferenceControls({
  availableProviders,
  selectedProvider,
  showProviderPicker = true,
  providerLocked = false,
  providerSwitchPending = false,
  model,
  modelOptions,
  onProviderChange,
  onModelChange,
  onModelOptionChange,
  onEditModels,
  planMode = false,
  onPlanModeChange,
  includePlanMode = true,
  className,
}: ChatPreferenceControlsProps) {
  const providerConfig = availableProviders.find((provider) => provider.id === selectedProvider) ?? availableProviders[0]
  const selectedProviderLabel = selectedProvider === "claude"
    ? "Claude"
    : providerConfig?.label ?? selectedProvider
  const ProviderIcon = PROVIDER_ICONS[selectedProvider]
  const ModelIcon = Box
  const codexModelOptions = selectedProvider === "codex" ? modelOptions as CodexModelOptions : null
  // Central availability registry (shared with the command palette): which
  // option controls exist for this provider/model and their current values.
  const controls = deriveComposerOptionControls(
    { provider: selectedProvider, model, modelOptions, planMode } as ComposerState,
    providerConfig
  )
  const showPlanMode = includePlanMode && controls.planMode && onPlanModeChange
  const ContextWindowIcon = controls.contextWindow?.selectedId === "1m" ? SquareMenu : SquareMinus

  const reasoningChangeFor = (effortId: string): ModelOptionChange =>
    selectedProvider === "claude"
      ? { type: "claudeReasoningEffort", effort: effortId as ClaudeReasoningEffort }
      : selectedProvider === "pi"
        ? { type: "piReasoningEffort", effort: effortId as PiReasoningEffort }
        : { type: "codexReasoningEffort", effort: effortId as CodexReasoningEffort }

  return (
    <div className={cn("flex md:justify-center items-center gap-0.5", className)}>
      {showProviderPicker ? (
        <InputPopover
          disabled={providerLocked || !onProviderChange}
          trigger={(
            <>
              <ProviderIcon className="h-3.5 w-3.5" />
              <span>{selectedProviderLabel}</span>
            </>
          )}
          // Amber = staged harness switch (applies on the next message).
          triggerClassName={providerSwitchPending ? "text-amber-500 dark:text-amber-400" : undefined}
        >
          {(close) => availableProviders.map((provider) => {
            const Icon = PROVIDER_ICONS[provider.id]
            return (
              <PopoverMenuItem
                key={provider.id}
                onClick={() => {
                  onProviderChange?.(provider.id)
                  close()
                }}
                selected={selectedProvider === provider.id}
                icon={<Icon className="h-4 w-4 text-muted-foreground" />}
                label={provider.label}
              />
            )
          })}
        </InputPopover>
      ) : null}

      <InputPopover
        trigger={(
          <>
            <ModelIcon className="h-3.5 w-3.5" />
            <span>{resolveModelLabel(providerConfig.models, model)}</span>
          </>
        )}
      >
        {(close) => (
          <ModelPickerList
            models={providerConfig.models}
            selectedModel={model}
            onSelect={(modelId) => {
              onModelChange(selectedProvider, modelId)
              close()
            }}
            renderLabel={(candidate) =>
              candidate.id === "gpt-5.6-luna" && codexModelOptions?.reasoningEffort === "ultra" ? (
                <>
                  {candidate.label}{" "}
                  <span className="text-xs font-normal text-muted-foreground">Ultra → Max</span>
                </>
              ) : (
                candidate.label
              )
            }
            footer={selectedProvider === "pi" && onEditModels ? (
              <PopoverMenuItem
                onClick={() => {
                  close()
                  onEditModels()
                }}
                selected={false}
                icon={<Plus className="h-4 w-4 text-muted-foreground" />}
                label="Add models…"
              />
            ) : null}
          />
        )}
      </InputPopover>

      {controls.reasoning ? (
        <InputPopover
          trigger={(
            <>
              <Brain className="h-3.5 w-3.5" />
              <span>{
                controls.reasoning.options.find((effort) => effort.id === controls.reasoning?.selectedId)?.label
                  ?? controls.reasoning.selectedId
              }</span>
            </>
          )}
        >
          {(close) => controls.reasoning?.options.map((effort) => (
            <PopoverMenuItem
              key={effort.id}
              onClick={() => {
                onModelOptionChange(reasoningChangeFor(effort.id))
                close()
              }}
              selected={controls.reasoning?.selectedId === effort.id}
              icon={<Brain className="h-4 w-4 text-muted-foreground" />}
              label={effort.label}
              description={effort.description}
              disabled={effort.disabled}
            />
          ))}
        </InputPopover>
      ) : null}

      {controls.contextWindow ? (
        <InputPopover
          trigger={(
            <>
              <ContextWindowIcon className="h-3.5 w-3.5" />
              <span>{
                controls.contextWindow.options.find((option) => option.id === controls.contextWindow?.selectedId)?.label
                  ?? controls.contextWindow.selectedId
              }</span>
            </>
          )}
        >
          {(close) => controls.contextWindow?.options.map((option) => (
            <PopoverMenuItem
              key={option.id}
                onClick={() => {
                  onModelOptionChange({ type: "contextWindow", contextWindow: option.id as ClaudeContextWindow })
                  close()
                }}
                selected={controls.contextWindow?.selectedId === option.id}
                icon={option.id === "1m"
                  ? <SquareMenu className="h-4 w-4 text-muted-foreground" />
                  : <SquareMinus className="h-4 w-4 text-muted-foreground" />}
                label={option.label}
              />
          ))}
        </InputPopover>
      ) : null}

      {controls.fastMode ? (() => {
        const fastEnabled = controls.fastMode.enabled
        const fastLabel = selectedProvider === "cursor" ? "Fast" : "Fast Mode"
        return (
          <InputPopover
            trigger={(
              <>
                {fastEnabled
                  ? <Gauge className="h-3.5 w-3.5" />
                  : <Gauge className="h-3.5 w-3.5 -scale-x-100" />}
                <span>{fastEnabled ? fastLabel : "Standard"}</span>
              </>
            )}
            triggerClassName={fastEnabled ? "text-emerald-500 dark:text-emerald-400" : undefined}
          >
            {(close) => (
              <>
                <PopoverMenuItem
                  onClick={() => {
                    onModelOptionChange({ type: "fastMode", fastMode: false })
                    close()
                  }}
                  selected={!fastEnabled}
                  icon={<Gauge className="h-4 w-4 text-muted-foreground -scale-x-100" />}
                  label="Standard"
                />
                <PopoverMenuItem
                  onClick={() => {
                    onModelOptionChange({ type: "fastMode", fastMode: true })
                    close()
                  }}
                  selected={fastEnabled}
                  icon={<Gauge className="h-4 w-4 text-muted-foreground" />}
                  label={fastLabel}
                  description={selectedProvider === "cursor" ? "Faster responses, higher usage" : undefined}
                />
              </>
            )}
          </InputPopover>
        )
      })() : null}

      {showPlanMode ? (
        <InputPopover
          trigger={(
            <>
              {planMode ? <ListTodo className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
              <span>{planMode ? "Plan Mode" : "Full Access"}</span>
            </>
          )}
          triggerClassName={planMode ? "text-blue-400 dark:text-blue-300" : undefined}
        >
          {(close) => (
            <>
              <PopoverMenuItem
                onClick={() => {
                  onPlanModeChange(false)
                  close()
                }}
                selected={!planMode}
                icon={<LockOpen className="h-4 w-4 text-muted-foreground" />}
                label="Full Access"
                description="Execution without approval"
              />
              <PopoverMenuItem
                onClick={() => {
                  onPlanModeChange(true)
                  close()
                }}
                selected={planMode}
                icon={<ListTodo className="h-4 w-4 text-muted-foreground" />}
                label="Plan Mode"
                description="Review a plan before execution"
              />
            </>
          )}
        </InputPopover>
      ) : null}
    </div>
  )
}
