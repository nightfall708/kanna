import type { ReactNode } from "react"
import { Loader2, MessageCircle } from "lucide-react"
import type { SidebarChatRow } from "../../../shared/types"
import type { SidebarThread } from "../../lib/thread-sections"
import { cn } from "../../lib/utils"
import { AnimatedShinyText } from "../ui/animated-shiny-text"
import { PROVIDER_ICONS } from "./ChatPreferenceControls"

/**
 * Canonical inner content of a thread row — status glyph / harness icon,
 * title (shimmering while running), optional prompt preview, and the trailing
 * project label. Shared by the command palette's thread items and the
 * sidebar's Review / In Progress / Recents sections; the caller supplies the
 * flex row container (CommandItem in the palette, a button in the sidebar).
 */

function statusDotClass(archived: boolean) {
  return archived ? "text-muted-foreground/50" : "text-muted-foreground"
}

/**
 * Status glyph mirroring the sidebar chat rows: spinner while running, a
 * blue ping when waiting on the user, a green ping when unread. Returns null
 * for idle chats so callers can fall back to a default icon.
 */
export function renderChatStatusDot(chat: SidebarChatRow): ReactNode | null {
  if (chat.status === "starting" || chat.status === "running") {
    return <Loader2 className="size-3.5 shrink-0 animate-spin text-logo" />
  }
  const color = chat.status === "waiting_for_user" ? "blue" : chat.unread ? "emerald" : null
  if (!color) return null
  return (
    <div className="relative flex size-4 shrink-0 items-center justify-center">
      <div
        className={cn(
          "absolute size-2.5 rounded-full animate-ping",
          color === "blue" ? "bg-blue-400/80" : "bg-emerald-400/80",
        )}
      />
      <div
        className={cn(
          "size-2.5 rounded-full ring-2 ring-muted/20 dark:ring-muted/50",
          color === "blue" ? "bg-blue-400" : "bg-emerald-400",
        )}
      />
    </div>
  )
}

export function ThreadRowContent({
  thread,
  showStatus = false,
  showPreview = false,
}: {
  thread: SidebarThread
  /** Use the sidebar status glyph (ping dots / spinner) instead of the chat icon. */
  showStatus?: boolean
  /** Fill the middle with a faint preview of the latest user prompt. */
  showPreview?: boolean
}) {
  const statusDot = showStatus ? renderChatStatusDot(thread.row) : null
  // Faint preview of the latest user prompt (already on the sidebar row). Fills
  // the space between the title and the trailing project/time, truncating tail.
  const previewText = showPreview ? thread.row.lastUserMessagePreview?.trim() || null : null
  // No status dot → show the chat's harness icon (falls back to a chat bubble
  // when the provider is unknown).
  const HarnessIcon = thread.row.provider ? PROVIDER_ICONS[thread.row.provider] : null
  return (
    <>
      {statusDot ?? (HarnessIcon
        ? <HarnessIcon className={`h-4 w-4 ${statusDotClass(thread.archived)}`} />
        : <MessageCircle className={`h-4 w-4 ${statusDotClass(thread.archived)}`} />)}
      {thread.row.status === "running" || thread.row.status === "starting" ? (
        <AnimatedShinyText
          className="!mx-0 min-w-0 shrink truncate"
          animate={thread.row.status === "running"}
          shimmerWidth={Math.max(20, thread.title.length * 3)}
        >
          {thread.title}
        </AnimatedShinyText>
      ) : (
        <span className="min-w-0 shrink truncate">{thread.title}</span>
      )}
      {previewText ? (
        // Grows to fill the middle and truncates its tail; -ml-1 offsets part
        // of the parent gap so it hugs the title.
        <span className="-ml-1 min-w-0 flex-1 truncate text-xs text-muted-foreground">{previewText}</span>
      ) : null}
      <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-3 text-xs">
        {thread.archived ? (
          <span className="rounded border border-border px-1 py-px text-[10px] uppercase tracking-wide text-muted-foreground">Archived</span>
        ) : null}
        <span className="max-w-[140px] truncate text-muted-foreground">{thread.projectTitle}</span>
      </span>
    </>
  )
}
