import { useEffect, useMemo, useState, type ComponentType } from "react"
import { flushSync } from "react-dom"
import { Check, CircleDashed, CircleDot, Folder, GitBranch, GitPullRequest } from "lucide-react"
import type { ChatDiffSnapshot, LocalProjectSummary, SidebarChatRow, SidebarData } from "../../shared/types"
import type { KannaSocket } from "../app/socket"
import {
  getProjectBoardColumns,
  getProjectBoardDiffTotals,
  type ProjectBoardChat,
  type ProjectBoardColumnId,
} from "../lib/projectBoard"
import { formatSidebarAgeLabel } from "../lib/formatters"
import { BOARD_PROJECT_FILTERS_STORAGE_KEY } from "../lib/storageKeys"
import { cn } from "../lib/utils"
import { groupProjectsByRecency } from "./LocalDev"
import { PROVIDER_ICONS } from "./chat-ui/ChatPreferenceControls"
import { ChatRowMenu } from "./chat-ui/sidebar/Menus"
import { AnimatedShinyText } from "./ui/animated-shiny-text"
import { Card, CardFooter, CardHeader, CardTitle } from "./ui/card"
import { Kanban, KanbanColumn, KanbanItem, KanbanOverlay, type KanbanMoveEvent } from "./ui/kanban"

const BOARD_COLUMNS: Array<{
  id: ProjectBoardColumnId
  title: string
  icon: ComponentType<{ className?: string }>
  iconClassName: string
  emptyLabel: string
}> = [
  // Icon colors mirror the sidebar chat-row status indicators.
  { id: "running", title: "Running", icon: CircleDashed, iconClassName: "text-logo", emptyLabel: "No conversations running" },
  { id: "waiting", title: "Review", icon: CircleDot, iconClassName: "text-blue-400", emptyLabel: "Nothing to review" },
  { id: "done", title: "Done", icon: Check, iconClassName: "text-emerald-600 dark:text-emerald-400", emptyLabel: "No completed conversations" },
]

export interface ProjectBoardMove {
  chatId: string
  fromColumn: ProjectBoardColumnId
}

interface ProjectBoardProps {
  data: SidebarData
  /** Local projects, used to order the filter pills like the "/" page. */
  localProjects: LocalProjectSummary[]
  socket: KannaSocket
  onOpenChat: (chatId: string, archived: boolean, columnId: ProjectBoardColumnId) => void
  onMarkChatDone: (chat: SidebarChatRow) => void
  onRenameChat: (chat: SidebarChatRow) => void
  onShareChat: (chatId: string) => void
  onForkChat: (chat: SidebarChatRow) => void
  onArchiveChat: (chat: SidebarChatRow) => void
  onDeleteChat: (chat: SidebarChatRow) => void
  onOpenChatInFinder: (localPath: string) => void
  /** When set, the card is first rendered in `fromColumn`, then animated to its real column. */
  animateMove?: ProjectBoardMove | null
}

function getBoardCardViewTransitionName(chatId: string) {
  return `board-card-${chatId.replace(/[^a-zA-Z0-9_-]/g, "-")}`
}

function readStoredBoardProjectFilters(): ReadonlySet<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(BOARD_PROJECT_FILTERS_STORAGE_KEY) ?? "[]")
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is string => typeof value === "string"))
  } catch {
    return new Set()
  }
}

function persistBoardProjectFilters(projectIds: ReadonlySet<string>) {
  if (typeof window === "undefined") return
  if (projectIds.size === 0) {
    window.localStorage.removeItem(BOARD_PROJECT_FILTERS_STORAGE_KEY)
    return
  }
  window.localStorage.setItem(BOARD_PROJECT_FILTERS_STORAGE_KEY, JSON.stringify([...projectIds]))
}

function getBoardFilterPillClass(active: boolean) {
  return cn(
    "h-7 shrink-0 cursor-pointer whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors",
    active
      ? "border-transparent bg-muted text-foreground"
      : "border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground"
  )
}

function getColumnAssignments(data: SidebarData) {
  const columns = getProjectBoardColumns(data)
  const assignments = new Map<string, ProjectBoardColumnId>()
  for (const columnId of ["running", "waiting", "done"] as const) {
    for (const entry of columns[columnId]) {
      assignments.set(entry.chat.chatId, columnId)
    }
  }
  return assignments
}

/** True when any chat present in both snapshots sits in a different column. */
function hasColumnMoves(previous: SidebarData, next: SidebarData) {
  const previousAssignments = getColumnAssignments(previous)
  const nextAssignments = getColumnAssignments(next)
  for (const [chatId, columnId] of nextAssignments) {
    const previousColumnId = previousAssignments.get(chatId)
    if (previousColumnId !== undefined && previousColumnId !== columnId) return true
  }
  return false
}

function getWaitingReasonLabel(pendingToolKind: string | undefined) {
  switch (pendingToolKind) {
    case "ask_user_question":
      return "Has questions"
    case "exit_plan_mode":
      return "Plan ready for review"
    default:
      return "Needs permission"
  }
}

function getBoardCardPreview(entry: ProjectBoardChat): { text: string; isWaitingReason: boolean } | null {
  if (entry.columnId === "running") {
    return entry.chat.lastUserMessagePreview
      ? { text: entry.chat.lastUserMessagePreview, isWaitingReason: false }
      : null
  }

  if (entry.columnId === "waiting") {
    if (entry.chat.status === "waiting_for_user") {
      return { text: getWaitingReasonLabel(entry.chat.pendingToolKind), isWaitingReason: true }
    }
    return entry.chat.lastAgentMessagePreview
      ? { text: entry.chat.lastAgentMessagePreview, isWaitingReason: false }
      : null
  }

  return null
}

function useProjectBoardDiffs(
  socket: KannaSocket,
  entries: ProjectBoardChat[]
) {
  const [snapshots, setSnapshots] = useState<Record<string, ChatDiffSnapshot | null>>({})
  const targets = useMemo(() => {
    const chatIdByProjectId = new Map<string, string>()
    for (const entry of entries) {
      if (!chatIdByProjectId.has(entry.projectId)) {
        chatIdByProjectId.set(entry.projectId, entry.chat.chatId)
      }
    }
    return [...chatIdByProjectId.entries()].map(([projectId, chatId]) => ({ projectId, chatId }))
  }, [entries])
  const targetKey = targets.map(({ projectId, chatId }) => `${projectId}:${chatId}`).join("\u0000")

  useEffect(() => {
    const projectIds = new Set(targets.map(({ projectId }) => projectId))
    setSnapshots((current) => Object.fromEntries(
      [...projectIds].map((projectId) => [projectId, current[projectId] ?? null])
    ))

    const unsubscribe = targets.map(({ projectId, chatId }) => {
      const stop = socket.subscribe<ChatDiffSnapshot | null>(
        { type: "project-git", projectId },
        (snapshot) => {
          setSnapshots((current) => ({ ...current, [projectId]: snapshot }))
        }
      )

      void socket.command({ type: "chat.refreshDiffs", chatId }).catch(() => undefined)
      return stop
    })

    return () => {
      for (const stop of unsubscribe) stop()
    }
  }, [socket, targetKey])

  return snapshots
}

function BoardCardContent({
  entry,
  diffs,
  nowMs,
}: {
  entry: ProjectBoardChat
  diffs: ChatDiffSnapshot | null
  nowMs: number
}) {
  const preview = getBoardCardPreview(entry)
  const totals = getProjectBoardDiffTotals(diffs?.files ?? [])
  const hasChanges = totals.additions > 0 || totals.deletions > 0
  // "repo/branch" (e.g. tapes/main), or just the project name when there is no repo.
  const repoLabel = diffs && diffs.status !== "no_repo" && diffs.branchName
    ? `${entry.projectTitle}/${diffs.branchName}`
    : entry.projectTitle
  // Folder when there is no repo; PR icon when a pull request is checked out (matching the git sidebar).
  const RepoIcon = diffs?.status === "no_repo"
    ? Folder
    : diffs?.checkedOutPrNumber !== undefined ? GitPullRequest : GitBranch
  const HarnessIcon = entry.chat.provider ? PROVIDER_ICONS[entry.chat.provider] : null

  return (
    <Card className="flex flex-col rounded-xl border border-border bg-card shadow-none transition-colors group-hover/board-card:border-primary/30 group-hover/board-card:bg-muted/20">
      <CardHeader className="flex-row items-start gap-2 space-y-0 p-4 pb-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <CardTitle className="flex min-w-0 items-start gap-1.5 text-sm font-medium leading-5 tracking-normal">
            {HarnessIcon ? <HarnessIcon className="mt-[3px] size-3.5 shrink-0 text-muted-foreground" /> : null}
            <span className="line-clamp-3 min-w-0">
              {entry.columnId === "running" ? (
                <AnimatedShinyText
                  animate={entry.chat.status === "running"}
                  shimmerWidth={Math.max(20, entry.chat.title.length * 3)}
                >
                  {entry.chat.title}
                </AnimatedShinyText>
              ) : (
                entry.chat.title
              )}
            </span>
          </CardTitle>
          {preview ? (
            <p className={cn("truncate text-xs", preview.isWaitingReason ? "text-blue-400" : "text-muted-foreground")}>
              {preview.text}
            </p>
          ) : null}
        </div>
        <span className="flex h-5 shrink-0 items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">
            {formatSidebarAgeLabel(entry.timestamp, nowMs)}
          </span>
          {/* Status dot colors mirror the sidebar chat rows: blue = waiting on you, green = unread. */}
          {entry.chat.status === "waiting_for_user" ? (
            <span className="size-1.5 shrink-0 rounded-full bg-blue-400" aria-label="Waiting on you" />
          ) : entry.chat.unread ? (
            <span className="size-1.5 shrink-0 rounded-full bg-emerald-400" aria-label="Unread" />
          ) : null}
        </span>
      </CardHeader>
      <CardFooter className="flex min-w-0 justify-between gap-3 p-4 pt-0 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <RepoIcon className="size-3.5 shrink-0" />
          <span className="truncate text-foreground">{repoLabel}</span>
        </span>
        {hasChanges ? (
          <span className="flex shrink-0 items-center font-mono tabular-nums" aria-label={`${totals.additions} additions and ${totals.deletions} deletions`}>
            {totals.additions > 0 ? <span className="text-emerald-600 dark:text-emerald-400">+{totals.additions}</span> : null}
            {totals.deletions > 0 ? (
              <span className={totals.additions > 0 ? "ml-2 text-red-600 dark:text-red-400" : "text-red-600 dark:text-red-400"}>
                -{totals.deletions}
              </span>
            ) : null}
          </span>
        ) : null}
      </CardFooter>
    </Card>
  )
}

export function ProjectBoard({
  data,
  localProjects,
  socket,
  onOpenChat,
  onMarkChatDone,
  onRenameChat,
  onShareChat,
  onForkChat,
  onArchiveChat,
  onDeleteChat,
  onOpenChatInFinder,
  animateMove,
}: ProjectBoardProps) {
  // Chats optimistically moved to Done while the mark-done command round-trips.
  const [pendingDoneChatIds, setPendingDoneChatIds] = useState<ReadonlySet<string>>(new Set())
  // Card temporarily rendered in its previous column so the move to its real column animates.
  const [pendingMove, setPendingMove] = useState<ProjectBoardMove | null>(animateMove ?? null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  // Rendered snapshot of the sidebar data. Updates that move cards between
  // columns are committed inside a view transition so the cards glide over.
  const [displayData, setDisplayData] = useState(data)

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 30_000)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (data === displayData) return
    const doc = document as Document & { startViewTransition?: (callback: () => void) => unknown }
    if (typeof doc.startViewTransition === "function" && hasColumnMoves(displayData, data)) {
      doc.startViewTransition(() => {
        flushSync(() => setDisplayData(data))
      })
    } else {
      setDisplayData(data)
    }
  }, [data, displayData])

  const columns = useMemo(() => {
    const derived = getProjectBoardColumns(displayData)

    const running = [...derived.running]
    const waiting = [...derived.waiting]
    const done = [...derived.done]

    if (pendingDoneChatIds.size > 0) {
      const moved: ProjectBoardChat[] = []
      const keep = (entries: ProjectBoardChat[]) => entries.filter((entry) => {
        if (!pendingDoneChatIds.has(entry.chat.chatId)) return true
        moved.push(entry)
        return false
      })

      running.splice(0, running.length, ...keep(running))
      waiting.splice(0, waiting.length, ...keep(waiting))
      // Done is ordered by when chats entered it, so just-marked chats go on top.
      done.unshift(...moved.map((entry) => ({ ...entry, columnId: "done" as const })))
    }

    const columns = { running, waiting, done }

    if (pendingMove) {
      // Render the card in its previous column for the first frame; the effect below
      // then clears pendingMove inside a view transition so the move animates.
      for (const columnId of ["running", "waiting", "done"] as const) {
        if (columnId === pendingMove.fromColumn) continue
        const index = columns[columnId].findIndex((entry) => entry.chat.chatId === pendingMove.chatId)
        if (index === -1) continue
        const [entry] = columns[columnId].splice(index, 1)
        columns[pendingMove.fromColumn].unshift({ ...entry, columnId: pendingMove.fromColumn })
        break
      }
    }

    return columns
  }, [displayData, pendingDoneChatIds, pendingMove])

  useEffect(() => {
    if (!pendingMove) return
    const frame = requestAnimationFrame(() => {
      const doc = document as Document & { startViewTransition?: (callback: () => void) => unknown }
      if (typeof doc.startViewTransition === "function") {
        // The DOM must be committed synchronously inside the callback, before the
        // browser takes the "new" snapshot — React's async batching is too late.
        doc.startViewTransition(() => {
          flushSync(() => setPendingMove(null))
        })
      } else {
        setPendingMove(null)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [pendingMove])

  const entries = useMemo(
    () => [...columns.running, ...columns.waiting, ...columns.done],
    [columns]
  )
  const entryByChatId = useMemo(
    () => new Map(entries.map((entry) => [entry.chat.chatId, entry])),
    [entries]
  )
  const diffsByProjectId = useProjectBoardDiffs(socket, entries)

  // Projects with cards on the board, ordered like the "/" page (recency
  // groups, most recently edited first). Projects missing from local-projects
  // keep their board order at the end.
  const boardProjects = useMemo(() => {
    const byId = new Map<string, { projectId: string; title: string; localPath: string }>()
    for (const entry of entries) {
      if (!byId.has(entry.projectId)) {
        byId.set(entry.projectId, {
          projectId: entry.projectId,
          title: entry.projectTitle,
          localPath: entry.chat.localPath,
        })
      }
    }
    const orderByPath = new Map(
      groupProjectsByRecency(localProjects)
        .flatMap((group) => group.projects)
        .map((project, index) => [project.localPath, index] as const)
    )
    return [...byId.values()].sort((left, right) =>
      (orderByPath.get(left.localPath) ?? Number.MAX_SAFE_INTEGER)
      - (orderByPath.get(right.localPath) ?? Number.MAX_SAFE_INTEGER)
    )
  }, [entries, localProjects])

  // Selected project filters; empty means "All". Persisted so returning to
  // the board keeps the same filters.
  const [selectedProjectIds, setSelectedProjectIds] = useState<ReadonlySet<string>>(readStoredBoardProjectFilters)

  useEffect(() => {
    persistBoardProjectFilters(selectedProjectIds)
  }, [selectedProjectIds])

  // Drop selections for projects that no longer have cards on the board.
  // Skipped while the board is empty (e.g. before the first snapshot lands)
  // so a page load doesn't wipe the restored selection.
  useEffect(() => {
    if (boardProjects.length === 0) return
    setSelectedProjectIds((current) => {
      if (current.size === 0) return current
      const stillOnBoard = [...current].filter((projectId) =>
        boardProjects.some((project) => project.projectId === projectId)
      )
      return stillOnBoard.length === current.size ? current : new Set(stillOnBoard)
    })
  }, [boardProjects])

  function toggleProjectFilter(projectId: string) {
    setSelectedProjectIds((current) => {
      const next = new Set(current)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }

  const visibleColumns = useMemo(() => {
    if (selectedProjectIds.size === 0) return columns
    const keep = (columnEntries: ProjectBoardChat[]) =>
      columnEntries.filter((entry) => selectedProjectIds.has(entry.projectId))
    return {
      running: keep(columns.running),
      waiting: keep(columns.waiting),
      done: keep(columns.done),
    }
  }, [columns, selectedProjectIds])

  // Drop optimistic overrides once the server confirms the done state (or the chat disappears).
  useEffect(() => {
    if (pendingDoneChatIds.size === 0) return
    const derived = getProjectBoardColumns(displayData)
    const stillPending = [...pendingDoneChatIds].filter((chatId) =>
      [...derived.running, ...derived.waiting].some((entry) => entry.chat.chatId === chatId)
    )
    if (stillPending.length !== pendingDoneChatIds.size) {
      setPendingDoneChatIds(new Set(stillPending))
    }
  }, [displayData, pendingDoneChatIds])

  const kanbanColumns = useMemo(() => ({
    running: visibleColumns.running.map((entry) => entry.chat.chatId),
    waiting: visibleColumns.waiting.map((entry) => entry.chat.chatId),
    done: visibleColumns.done.map((entry) => entry.chat.chatId),
  }), [visibleColumns])

  function handleMove({ itemId, fromColumn, toColumn }: KanbanMoveEvent) {
    if (toColumn !== "done" || fromColumn === "done") return
    const entry = entryByChatId.get(itemId)
    if (!entry || entry.archived) return
    setPendingDoneChatIds((current) => new Set([...current, itemId]))
    onMarkChatDone(entry.chat)
  }

  return (
    <>
      {boardProjects.length > 0 ? (
        <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-4 pb-3 sm:px-6">
          <button
            type="button"
            aria-pressed={selectedProjectIds.size === 0}
            onClick={() => setSelectedProjectIds(new Set())}
            className={getBoardFilterPillClass(selectedProjectIds.size === 0)}
          >
            All
          </button>
          {boardProjects.map((project) => (
            <button
              key={project.projectId}
              type="button"
              aria-pressed={selectedProjectIds.has(project.projectId)}
              onClick={() => toggleProjectFilter(project.projectId)}
              className={getBoardFilterPillClass(selectedProjectIds.has(project.projectId))}
            >
              {project.title}
            </button>
          ))}
        </div>
      ) : null}
      {/*
        The board fills the space under the page header; each column scrolls its
        own card list. The horizontal scroller is full-bleed (gutters live inside
        the scroll content) so columns run edge to edge on narrow screens.
      */}
      <Kanban columns={kanbanColumns} onMove={handleMove} className="flex-1 min-h-0 overflow-x-auto">
      <div className="grid h-full min-w-[48rem] grid-cols-3 grid-rows-[minmax(0,1fr)] gap-2 px-4 pb-4 sm:px-6">
        {BOARD_COLUMNS.map((column) => (
          <KanbanColumn
            key={column.id}
            value={column.id}
            droppable={column.id === "done"}
            aria-labelledby={`project-board-${column.id}`}
            className={cn(
              "min-w-0 min-h-0 rounded-2xl p-2 transition-colors",
              "data-[drop-target]:bg-muted/40 data-[drop-target]:outline-dashed data-[drop-target]:outline-1 data-[drop-target]:-outline-offset-1 data-[drop-target]:outline-border",
              "data-[over]:bg-muted data-[over]:outline-primary/40"
            )}
          >
            <div className="mb-2 flex h-8 shrink-0 items-center gap-2 px-2">
              <column.icon className={cn("size-4", column.iconClassName)} />
              <h2 id={`project-board-${column.id}`} className="text-sm font-medium text-foreground">
                {column.title}
              </h2>
              <span className="text-sm tabular-nums text-muted-foreground">{visibleColumns[column.id].length}</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
              {visibleColumns[column.id].length > 0 ? visibleColumns[column.id].map((entry) => (
                <KanbanItem
                  key={entry.chat.chatId}
                  value={entry.chat.chatId}
                  disabled={column.id === "done"}
                  className={cn(
                    "group/board-card rounded-xl outline-none transition-opacity",
                    column.id === "done" && "cursor-pointer"
                  )}
                  style={{ viewTransitionName: getBoardCardViewTransitionName(entry.chat.chatId) }}
                  onClick={() => onOpenChat(entry.chat.chatId, entry.archived, column.id)}
                >
                  <ChatRowMenu
                    canFork={entry.chat.canFork}
                    onRename={() => onRenameChat(entry.chat)}
                    onShare={() => onShareChat(entry.chat.chatId)}
                    onOpenInFinder={() => onOpenChatInFinder(entry.chat.localPath)}
                    onFork={() => onForkChat(entry.chat)}
                    onArchive={() => onArchiveChat(entry.chat)}
                    onDelete={() => onDeleteChat(entry.chat)}
                  >
                    <div className="min-w-0">
                      <BoardCardContent entry={entry} diffs={diffsByProjectId[entry.projectId] ?? null} nowMs={nowMs} />
                    </div>
                  </ChatRowMenu>
                </KanbanItem>
              )) : (
                <div className="flex min-h-[100px] items-center justify-center rounded-xl border border-dashed border-border px-4 text-center text-xs text-muted-foreground">
                  {column.emptyLabel}
                </div>
              )}
            </div>
          </KanbanColumn>
        ))}
      </div>
      <KanbanOverlay>
        {(activeId) => {
          const entry = entryByChatId.get(activeId)
          if (!entry) return null
          return (
            <div className="rotate-2 rounded-xl shadow-lg">
              <BoardCardContent entry={entry} diffs={diffsByProjectId[entry.projectId] ?? null} nowMs={nowMs} />
            </div>
          )
        }}
      </KanbanOverlay>
      </Kanban>
    </>
  )
}
