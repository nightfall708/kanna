import { memo, useMemo } from "react"
import type { SidebarData } from "../../../../shared/types"
import {
  computeThreadSections,
  flattenSidebarThreads,
  type SidebarThread,
} from "../../../lib/thread-sections"
import { cn, normalizeChatId } from "../../../lib/utils"
import { ThreadRowContent } from "../ThreadRowContent"

interface Props {
  data: SidebarData
  activeChatId: string | null
  onSelectChat: (chatId: string) => void
}

/**
 * The command palette's empty-query sections (Review / In Progress / Recents)
 * pinned to the top of the sidebar. Renders nothing — including the divider —
 * when every section is empty; rows reuse the palette's compact thread row
 * (no prompt preview) and jump straight to the chat.
 */
function ThreadSectionsImpl({ data, activeChatId, onSelectChat }: Props) {
  const sections = useMemo(() => computeThreadSections(flattenSidebarThreads(data)), [data])
  const normalizedActiveChatId = activeChatId ? normalizeChatId(activeChatId) : null

  const groups: Array<{ key: string; heading: string; threads: SidebarThread[] }> = [
    { key: "in-progress", heading: "In Progress", threads: sections.inProgress },
    { key: "review", heading: "Review", threads: sections.review },
    { key: "recents", heading: "Recents", threads: sections.recent },
  ].filter((group) => group.threads.length > 0)

  if (groups.length === 0) return null

  return (
    // Full-bleed bottom border (mirrors the navbar's) dividing the sections
    // from the project groups; -mx cancels the scroll body's p-[7px].
    <div className="-mx-[7px] mb-1 border-b border-border px-[7px] pb-[15px]">
      {groups.map((group) => (
        <div key={group.key}>
          <div className="px-2 pb-1 pt-2.5 text-xs font-medium text-muted-foreground">{group.heading}</div>
          <div className="space-y-[2px]">
            {group.threads.map((thread) => (
              <button
                key={thread.chatId}
                // Same marker ChatRow uses. Because this section renders above
                // the project groups, the sidebar's scroll-to-active
                // querySelector finds this top copy first and scrolls up to it.
                data-chat-id={normalizeChatId(thread.chatId)}
                type="button"
                className={cn(
                  "flex w-full cursor-pointer select-none items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left text-sm active:scale-[0.985] transition-all [&_svg]:pointer-events-none [&_svg]:shrink-0",
                  normalizeChatId(thread.chatId) === normalizedActiveChatId
                    ? "bg-muted hover:bg-muted border-border"
                    : "border-border/0 hover:border-border hover:bg-muted/20 dark:hover:border-slate-400/10",
                )}
                onClick={() => onSelectChat(thread.chatId)}
              >
                <ThreadRowContent thread={thread} showStatus />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export const ThreadSections = memo(ThreadSectionsImpl)
