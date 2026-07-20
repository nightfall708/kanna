import commandScore from "command-score"
import type { LocalProjectSummary, SidebarChatRow, SidebarData } from "../../../shared/types"
import {
  listAllSettingsRowDefs,
  SETTINGS_SECTIONS,
  type SettingsRowDef,
  type SettingsSectionId,
} from "../../app/settings/registry"

/** Pure ranking/search helpers for the command palette (kept React-free for tests). */

export interface PaletteThread {
  chatId: string
  title: string
  projectId: string
  projectTitle: string
  archived: boolean
  lastActivityAt: number
  row: SidebarChatRow
}

export interface ScoredThread extends PaletteThread {
  score: number
}

/** Flattens the sidebar snapshot into one searchable thread list (active + archived). */
export function flattenSidebarThreads(data: SidebarData): PaletteThread[] {
  const threads: PaletteThread[] = []
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

export function getRecentThreads(threads: PaletteThread[], limit = 7): PaletteThread[] {
  return [...threads]
    .filter((thread) => !thread.archived)
    .sort((left, right) => right.lastActivityAt - left.lastActivityAt)
    .slice(0, limit)
}

/**
 * Fuzzy score for a palette entry: the best command-score across the title
 * and any extra keywords/aliases. Returns 0 for no match.
 */
export function scorePaletteItem(query: string, title: string, keywords: string[] = []): number {
  const trimmed = query.trim()
  if (!trimmed) return 1
  let best = commandScore(title, trimmed)
  for (const keyword of keywords) {
    if (best >= 1) break
    const score = commandScore(keyword, trimmed)
    if (score > best) best = score
  }
  return best
}

export function searchThreadsByTitle(threads: PaletteThread[], query: string, limit = 10): ScoredThread[] {
  const trimmed = query.trim()
  if (!trimmed) return []

  const scored: ScoredThread[] = []
  for (const thread of threads) {
    const score = scorePaletteItem(trimmed, thread.title, [thread.projectTitle])
    if (score > 0) {
      scored.push({ ...thread, score })
    }
  }

  return scored
    .sort((left, right) => (
      right.score !== left.score
        ? right.score - left.score
        : right.lastActivityAt - left.lastActivityAt
    ))
    .slice(0, limit)
}

export interface PaletteProject {
  /** Sidebar project id; null when the project hasn't been opened yet. */
  projectId: string | null
  title: string
  localPath: string
  /** Most recent active chat to jump to; null means selecting starts a new chat. */
  mostRecentChatId: string | null
  lastActivityAt: number
}

/**
 * All openable projects: sidebar project groups first (jump to their most
 * recent chat), then local projects that aren't in the sidebar yet
 * (selecting opens the project with a fresh chat).
 */
export function flattenPaletteProjects(
  data: SidebarData,
  localProjects: LocalProjectSummary[]
): PaletteProject[] {
  const projects: PaletteProject[] = []
  const seenPaths = new Set<string>()

  for (const group of data.projectGroups) {
    seenPaths.add(group.localPath)
    let mostRecentChatId: string | null = null
    let lastActivityAt = 0
    for (const chat of group.chats) {
      const activityAt = chat.lastMessageAt ?? chat._creationTime
      if (activityAt >= lastActivityAt) {
        lastActivityAt = activityAt
        mostRecentChatId = chat.chatId
      }
    }
    projects.push({
      projectId: group.groupKey,
      title: group.title,
      localPath: group.localPath,
      mostRecentChatId,
      lastActivityAt,
    })
  }

  for (const project of localProjects) {
    if (seenPaths.has(project.localPath)) continue
    seenPaths.add(project.localPath)
    projects.push({
      projectId: null,
      title: project.title,
      localPath: project.localPath,
      mostRecentChatId: null,
      lastActivityAt: project.lastOpenedAt ?? project.folderModifiedAt ?? 0,
    })
  }

  return projects
}

export interface ScoredProject extends PaletteProject {
  score: number
}

export function searchProjects(projects: PaletteProject[], query: string, limit = 6): ScoredProject[] {
  const trimmed = query.trim()
  if (!trimmed) return []

  return projects
    .map((project) => ({ ...project, score: scorePaletteItem(trimmed, project.title, [project.localPath]) }))
    .filter((project) => project.score > 0)
    .sort((left, right) => (
      right.score !== left.score
        ? right.score - left.score
        : right.lastActivityAt - left.lastActivityAt
    ))
    .slice(0, limit)
}

export interface SettingsPaletteEntry {
  id: string
  title: string
  /** Shown as the muted trail, e.g. "Settings › General". */
  sectionLabel: string
  keywords: string[]
  /** Router path incl. row anchor. */
  path: string
  sectionId: SettingsSectionId
}

function sectionLabelFor(sectionId: SettingsSectionId): string {
  return SETTINGS_SECTIONS.find((section) => section.id === sectionId)?.label ?? sectionId
}

/**
 * Every settings navigation target: each section plus every registered row.
 * Derived entirely from the settings registry — new rows appear automatically.
 */
export function getSettingsPaletteEntries(): SettingsPaletteEntry[] {
  const sections: SettingsPaletteEntry[] = SETTINGS_SECTIONS.map((section) => ({
    id: `settings-section-${section.id}`,
    title: section.label,
    sectionLabel: "Settings",
    keywords: ["settings", section.subtitle],
    path: `/settings/${section.id}`,
    sectionId: section.id,
  }))

  const rows: SettingsPaletteEntry[] = listAllSettingsRowDefs().map((row: SettingsRowDef) => ({
    id: `settings-row-${row.id}`,
    title: row.title,
    sectionLabel: `Settings › ${sectionLabelFor(row.sectionId)}`,
    keywords: ["settings", row.description, ...(row.keywords ?? [])],
    path: `/settings/${row.sectionId}#${row.id}`,
    sectionId: row.sectionId,
  }))

  return [...sections, ...rows]
}

export function searchSettingsEntries(
  entries: SettingsPaletteEntry[],
  query: string,
  limit = 8
): Array<SettingsPaletteEntry & { score: number }> {
  const trimmed = query.trim()
  if (!trimmed) return []

  return entries
    .map((entry) => ({ ...entry, score: scorePaletteItem(trimmed, entry.title, entry.keywords) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}
