import type { SidebarChatRow, SidebarData } from "../../shared/types"

/**
 * Canonical thread-section logic shared by the command palette (empty-query
 * quick switcher) and the sidebar's top sections. Kept React-free for tests.
 */

export interface SidebarThread {
  chatId: string
  title: string
  projectId: string
  projectTitle: string
  archived: boolean
  lastActivityAt: number
  row: SidebarChatRow
}

/** Flattens the sidebar snapshot into one searchable thread list (active + archived). */
export function flattenSidebarThreads(data: SidebarData): SidebarThread[] {
  const threads: SidebarThread[] = []
  for (const group of data.projectGroups) {
    const pushRows = (rows: SidebarChatRow[], archived: boolean) => {
      for (const row of rows) {
        threads.push({
          chatId: row.chatId,
          title: row.title,
          projectId: group.groupKey,
          projectTitle: group.title,
          archived,
          lastActivityAt: row.lastMessageAt ?? row._creationTime,
          row,
        })
      }
    }
    pushRows(group.chats, false)
    pushRows(group.archivedChats ?? [], true)
  }
  return threads
}

/**
 * Chats "ready for review" — exactly the ones that would show a status dot in
 * the sidebar as needing you: waiting on the user (plan/question) or unread.
 * Running chats (spinner, still in progress) and archived chats are excluded.
 * Sorted most-recent first so Cmd+K → Enter jumps to the freshest one.
 */
export function getReviewThreads(threads: SidebarThread[]): SidebarThread[] {
  return threads
    .filter((thread) => !thread.archived && (thread.row.status === "waiting_for_user" || thread.row.unread))
    .sort((left, right) => right.lastActivityAt - left.lastActivityAt)
}

/**
 * Chats still working (running/starting), minus any already surfaced in the
 * exclude set (typically the review section). Sorted most-recent first.
 */
export function getInProgressThreads(
  threads: SidebarThread[],
  exclude?: ReadonlySet<string>,
): SidebarThread[] {
  return threads
    .filter((thread) =>
      !thread.archived
      && !(exclude?.has(thread.chatId))
      && (thread.row.status === "running" || thread.row.status === "starting"))
    .sort((left, right) => right.lastActivityAt - left.lastActivityAt)
}

/** How many chats the "Recents" section shows. */
export const RECENT_THREADS_LIMIT = 5

export function getRecentThreads(
  threads: SidebarThread[],
  limit = RECENT_THREADS_LIMIT,
  exclude?: ReadonlySet<string>,
): SidebarThread[] {
  return threads
    .filter((thread) => !thread.archived && !(exclude?.has(thread.chatId)))
    .sort((left, right) => right.lastActivityAt - left.lastActivityAt)
    .slice(0, limit)
}

export interface ThreadSections {
  review: SidebarThread[]
  inProgress: SidebarThread[]
  recent: SidebarThread[]
}

/**
 * The three canonical sections, in display order: "Review" (waiting on you /
 * unread) leads and is uncapped; "In Progress" (running/starting, minus
 * review) follows uncapped; "Recents" is the most recent chats in neither,
 * capped at RECENT_THREADS_LIMIT, hiding empty new chats (no messages yet).
 */
export function computeThreadSections(threads: SidebarThread[]): ThreadSections {
  const review = getReviewThreads(threads)
  const inProgress = getInProgressThreads(threads, new Set(review.map((thread) => thread.chatId)))
  const excludeIds = new Set([...review, ...inProgress].map((thread) => thread.chatId))
  // Hide empty new chats (no messages yet → no lastMessageAt) from recents.
  const withMessages = threads.filter((thread) => thread.row.lastMessageAt != null)
  const recent = getRecentThreads(withMessages, RECENT_THREADS_LIMIT, excludeIds)
  return { review, inProgress, recent }
}
