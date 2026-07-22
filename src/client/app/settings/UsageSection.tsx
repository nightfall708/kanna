import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import type { ProviderUsageSnapshot, UsageLimitWindow, UsageLimitsSnapshot } from "../../../shared/types"
import { PROVIDERS } from "../../../shared/types"
import { PROVIDER_ICONS } from "../../components/chat-ui/ChatPreferenceControls"
import { SettingsHeaderButton } from "../../components/ui/settings-header-button"
import { formatRelativeTime } from "../../lib/formatters"
import { cn } from "../../lib/utils"
import type { KannaState } from "../useKannaState"

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** "in 40m" / "in 3h" / "in 2d" — future counterpart of formatRelativeTime. */
function formatUntil(isoTimestamp: string): string | null {
  const timestamp = Date.parse(isoTimestamp)
  if (!Number.isFinite(timestamp)) return null
  const delta = timestamp - Date.now()
  if (delta <= 0) return "now"
  if (delta < HOUR_MS) return `in ${Math.max(1, Math.round(delta / MINUTE_MS))}m`
  if (delta < DAY_MS) return `in ${Math.round(delta / HOUR_MS)}h`
  return `in ${Math.round(delta / DAY_MS)}d`
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—"
  if (value > 0 && value < 1) return "<1%"
  return `${Math.round(value)}%`
}

/** "$1,234.56" with comma grouping; falls back to a bare number for odd codes. */
function formatMoney(amount: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency ?? "USD" }).format(amount)
  } catch {
    return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
}

function creditsSummary(credits: NonNullable<ProviderUsageSnapshot["credits"]>): string | null {
  const parts: string[] = []
  if (credits.usedAmount != null) {
    const used = formatMoney(credits.usedAmount, credits.currency)
    parts.push(credits.limitAmount != null ? `${used} of ${formatMoney(credits.limitAmount, credits.currency)} used` : `${used} used`)
  }
  if (credits.usedPercent != null) parts.push(`${formatPercent(credits.usedPercent)} used`)
  if (credits.detail) {
    // Codex reports its prepaid balance as a bare numeric string ("1000");
    // render it as a remaining count. Non-numeric details ("Unlimited") pass through.
    const numeric = /^\d+(\.\d+)?$/.test(credits.detail.trim()) ? Number(credits.detail) : null
    parts.push(numeric !== null ? `${numeric.toLocaleString("en-US")} credits remaining` : credits.detail)
  }
  return parts.length > 0 ? parts.join(" · ") : null
}

function providerLabel(providerId: string): string {
  return PROVIDERS.find((entry) => entry.id === providerId)?.label ?? providerId
}

function barColorClass(usedPercent: number | null): string {
  if (usedPercent === null) return "bg-muted-foreground/40"
  if (usedPercent >= 90) return "bg-red-500"
  if (usedPercent >= 75) return "bg-amber-500"
  return "bg-emerald-500"
}

function UsageBar({ usedPercent }: { usedPercent: number | null }) {
  const width = usedPercent === null ? 0 : Math.max(usedPercent > 0 ? 1.5 : 0, Math.min(100, usedPercent))
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", barColorClass(usedPercent))}
        style={{ width: `${width}%` }}
      />
    </div>
  )
}

function WindowRow({ window }: { window: UsageLimitWindow }) {
  const resets = window.resetsAt ? formatUntil(window.resetsAt) : null
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 truncate text-sm text-foreground">{window.label}</div>
        <div className="shrink-0 text-sm font-medium tabular-nums text-foreground">
          {formatPercent(window.usedPercent)}
        </div>
      </div>
      <div className="mt-1.5">
        <UsageBar usedPercent={window.usedPercent} />
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <span>{resets ? `Resets ${resets}` : " "}</span>
        <span>as of {formatRelativeTime(window.recordedAt)}</span>
      </div>
    </div>
  )
}

function ProviderCard({ snapshot }: { snapshot: ProviderUsageSnapshot }) {
  const Icon = PROVIDER_ICONS[snapshot.provider]
  const hasContent = snapshot.windows.length > 0 || snapshot.credits
  return (
    <div className="rounded-2xl border border-border bg-card/40 px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon className="h-4 w-4 shrink-0 text-foreground" />
          <span className="truncate text-sm font-semibold text-foreground">
            {providerLabel(snapshot.provider)}
          </span>
          {snapshot.plan ? (
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
              {snapshot.plan}
            </span>
          ) : null}
        </div>
        {snapshot.updatedAt ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            Updated {formatRelativeTime(snapshot.updatedAt)}
          </span>
        ) : null}
      </div>

      {hasContent ? (
        <div className="mt-4 space-y-4">
          {snapshot.windows.map((window) => (
            <WindowRow key={window.id} window={window} />
          ))}
          {snapshot.credits ? (
            <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3 text-sm">
              <span className="text-foreground">{snapshot.credits.label}</span>
              <span className="text-muted-foreground">{creditsSummary(snapshot.credits)}</span>
            </div>
          ) : null}
          {snapshot.detail ? (
            <div className="text-xs text-muted-foreground">{snapshot.detail}</div>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 text-sm text-muted-foreground">
          {snapshot.detail
            ?? (snapshot.status === "unknown" ? "No usage recorded yet." : "Usage limits are not available.")}
        </div>
      )}
    </div>
  )
}

export function UsageSection({ state }: { state: Pick<KannaState, "socket"> }) {
  const socket = state.socket
  const [snapshot, setSnapshot] = useState<UsageLimitsSnapshot | null>(null)
  const [refreshing, setRefreshing] = useState(true)

  useEffect(() => {
    // Subscribing also kicks a fresh server-side read; pushed updates land here.
    let sawFirstPush = false
    return socket.subscribe<UsageLimitsSnapshot>({ type: "usage-limits" }, (data) => {
      setSnapshot(data)
      // The first push is the cached snapshot; the second is the fresh read.
      if (sawFirstPush) setRefreshing(false)
      sawFirstPush = true
    })
  }, [socket])

  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      const result = await socket.command<UsageLimitsSnapshot>({ type: "usage.refresh" })
      if (result && Array.isArray(result.providers)) setSnapshot(result)
    } catch {
      // Errors surface as "unavailable" provider states in the snapshot.
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <SettingsHeaderButton
          variant="outline"
          onClick={() => {
            void handleRefresh()
          }}
          icon={<RefreshCw className={cn("h-4 w-4", refreshing ? "animate-spin" : undefined)} />}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </SettingsHeaderButton>
      </div>
      {snapshot ? (
        snapshot.providers.map((provider) => (
          <ProviderCard key={provider.provider} snapshot={provider} />
        ))
      ) : (
        <div className="rounded-2xl border border-border bg-card/40 px-5 py-6 text-sm text-muted-foreground">
          Loading usage…
        </div>
      )}
    </div>
  )
}
