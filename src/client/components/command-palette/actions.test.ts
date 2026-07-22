import { describe, expect, test } from "bun:test"
import type { LocalProjectSummary, SidebarChatRow, SidebarData } from "../../../shared/types"
import {
  flattenPaletteProjects,
  flattenSidebarThreads,
  getRecentThreads,
  getReviewThreads,
  getSettingsPaletteEntries,
  scorePaletteItem,
  searchProjects,
  searchSettingsEntries,
  searchThreadsByTitle,
} from "./actions"

function makeChatRow(overrides: Partial<SidebarChatRow> & Pick<SidebarChatRow, "chatId" | "title">): SidebarChatRow {
  return {
    _id: overrides.chatId,
    _creationTime: 1_000,
    status: "idle",
    unread: false,
    localPath: "/tmp/project",
    provider: "claude",
    hasAutomation: false,
    ...overrides,
  }
}

function makeSidebarData(): SidebarData {
  return {
    projectGroups: [
      {
        groupKey: "project-a",
        title: "Kanna",
        realTitle: "Kanna",
        localPath: "/Users/jake/Projects/kanna",
        chats: [
          makeChatRow({ chatId: "chat-1", title: "Fix websocket reconnect", lastMessageAt: 300 }),
          makeChatRow({ chatId: "chat-2", title: "Command palette design", lastMessageAt: 900 }),
        ],
        previewChats: [],
        olderChats: [],
        archivedChats: [
          makeChatRow({ chatId: "chat-3", title: "Old palette prototype", lastMessageAt: 100 }),
        ],
        defaultCollapsed: false,
      },
      {
        groupKey: "project-b",
        title: "Superwall",
        realTitle: "Superwall",
        localPath: "/Users/jake/Projects/superwall",
        chats: [
          makeChatRow({ chatId: "chat-4", title: "Paywall experiments", lastMessageAt: 600 }),
        ],
        previewChats: [],
        olderChats: [],
        defaultCollapsed: false,
      },
    ],
  }
}

describe("flattenSidebarThreads", () => {
  test("includes active and archived chats with project metadata", () => {
    const threads = flattenSidebarThreads(makeSidebarData())
    expect(threads).toHaveLength(4)

    const archived = threads.find((thread) => thread.chatId === "chat-3")
    expect(archived?.archived).toBe(true)
    expect(archived?.projectTitle).toBe("Kanna")

    const active = threads.find((thread) => thread.chatId === "chat-4")
    expect(active?.archived).toBe(false)
    expect(active?.projectId).toBe("project-b")
  })

  test("falls back to creation time when lastMessageAt is missing", () => {
    const data = makeSidebarData()
    data.projectGroups[0].chats.push(makeChatRow({ chatId: "chat-5", title: "Draft" }))
    const threads = flattenSidebarThreads(data)
    expect(threads.find((thread) => thread.chatId === "chat-5")?.lastActivityAt).toBe(1_000)
  })
})

describe("getRecentThreads", () => {
  test("sorts by recency and excludes archived chats", () => {
    const threads = flattenSidebarThreads(makeSidebarData())
    const recent = getRecentThreads(threads, 3)
    expect(recent.map((thread) => thread.chatId)).toEqual(["chat-2", "chat-4", "chat-1"])
  })

  test("excludes chatIds passed in the exclude set", () => {
    const threads = flattenSidebarThreads(makeSidebarData())
    const recent = getRecentThreads(threads, 3, new Set(["chat-2"]))
    expect(recent.map((thread) => thread.chatId)).toEqual(["chat-4", "chat-1"])
  })
})

describe("getReviewThreads", () => {
  test("selects waiting_for_user / unread chats (sidebar dot), most recent first", () => {
    const data: SidebarData = {
      projectGroups: [
        {
          groupKey: "p",
          title: "P",
          realTitle: "P",
          localPath: "/tmp/p",
          chats: [
            makeChatRow({ chatId: "waiting", title: "Waiting", status: "waiting_for_user", lastMessageAt: 300 }),
            makeChatRow({ chatId: "unread", title: "Unread", unread: true, lastMessageAt: 600 }),
            makeChatRow({ chatId: "idle", title: "Idle", lastMessageAt: 900 }),
            makeChatRow({ chatId: "running", title: "Running", status: "running", lastMessageAt: 950 }),
          ],
          previewChats: [],
          olderChats: [],
          archivedChats: [
            makeChatRow({ chatId: "archived-unread", title: "Archived", unread: true, lastMessageAt: 990 }),
          ],
          defaultCollapsed: false,
        },
      ],
    }
    const review = getReviewThreads(flattenSidebarThreads(data))
    // unread (600) before waiting (300); idle, running, and archived excluded.
    expect(review.map((thread) => thread.chatId)).toEqual(["unread", "waiting"])
  })
})

describe("searchThreadsByTitle", () => {
  test("returns empty for an empty query", () => {
    const threads = flattenSidebarThreads(makeSidebarData())
    expect(searchThreadsByTitle(threads, "  ")).toEqual([])
  })

  test("matches titles fuzzily and includes archived threads", () => {
    const threads = flattenSidebarThreads(makeSidebarData())
    const results = searchThreadsByTitle(threads, "palette")
    expect(results.map((thread) => thread.chatId)).toContain("chat-2")
    expect(results.map((thread) => thread.chatId)).toContain("chat-3")
  })

  test("matches on project title as an alias", () => {
    const threads = flattenSidebarThreads(makeSidebarData())
    const results = searchThreadsByTitle(threads, "superwall")
    expect(results.map((thread) => thread.chatId)).toContain("chat-4")
  })

  test("breaks score ties by recency", () => {
    const threads = flattenSidebarThreads({
      projectGroups: [
        {
          groupKey: "p",
          title: "P",
          realTitle: "P",
          localPath: "/tmp/p",
          chats: [
            makeChatRow({ chatId: "older", title: "Same title", lastMessageAt: 10 }),
            makeChatRow({ chatId: "newer", title: "Same title", lastMessageAt: 20 }),
          ],
          previewChats: [],
          olderChats: [],
          defaultCollapsed: false,
        },
      ],
    })
    const results = searchThreadsByTitle(threads, "same title")
    expect(results.map((thread) => thread.chatId)).toEqual(["newer", "older"])
  })
})

describe("flattenPaletteProjects", () => {
  const localProjects: LocalProjectSummary[] = [
    {
      localPath: "/Users/jake/Projects/kanna",
      title: "Kanna (saved)",
      source: "saved",
      chatCount: 3,
    },
    {
      localPath: "/Users/jake/Projects/fresh",
      title: "Fresh",
      source: "discovered",
      lastOpenedAt: 50,
      chatCount: 0,
    },
  ]

  test("sidebar projects point at their most recent chat", () => {
    const projects = flattenPaletteProjects(makeSidebarData(), localProjects)
    const kanna = projects.find((project) => project.projectId === "project-a")
    expect(kanna?.mostRecentChatId).toBe("chat-2")
    expect(kanna?.title).toBe("Kanna")
  })

  test("sidebar projects with no active chats have no target chat", () => {
    const data = makeSidebarData()
    data.projectGroups[0].chats = []
    const projects = flattenPaletteProjects(data, [])
    const kanna = projects.find((project) => project.projectId === "project-a")
    expect(kanna?.mostRecentChatId).toBeNull()
  })

  test("local projects are included once, deduped against sidebar paths", () => {
    const projects = flattenPaletteProjects(makeSidebarData(), localProjects)
    // /Projects/kanna already exists as a sidebar group — the local copy is skipped.
    expect(projects.filter((project) => project.localPath.endsWith("/kanna"))).toHaveLength(1)

    const fresh = projects.find((project) => project.localPath.endsWith("/fresh"))
    expect(fresh?.projectId).toBeNull()
    expect(fresh?.mostRecentChatId).toBeNull()
  })
})

describe("searchProjects", () => {
  test("matches by title and path, empty query returns nothing", () => {
    const projects = flattenPaletteProjects(makeSidebarData(), [])
    expect(searchProjects(projects, "")).toEqual([])
    expect(searchProjects(projects, "kanna").map((project) => project.projectId)).toEqual(["project-a"])
    expect(searchProjects(projects, "superwall").map((project) => project.projectId)).toEqual(["project-b"])
  })
})

describe("scorePaletteItem", () => {
  test("matches on keywords when the title misses", () => {
    expect(scorePaletteItem("kanban", "Go to Board", ["kanban", "navigate"])).toBeGreaterThan(0)
    expect(scorePaletteItem("zzzz", "Go to Board", ["kanban"])).toBe(0)
  })

  test("empty query matches everything", () => {
    expect(scorePaletteItem("", "Anything")).toBe(1)
  })
})

describe("getSettingsPaletteEntries", () => {
  test("includes every section and registry row", () => {
    const entries = getSettingsPaletteEntries()
    const ids = entries.map((entry) => entry.id)

    // Sections
    expect(ids).toContain("settings-section-general")
    expect(ids).toContain("settings-section-changelog")

    // Registry rows carry anchored paths
    const theme = entries.find((entry) => entry.id === "settings-row-theme")
    expect(theme?.path).toBe("/settings/general#theme")
    expect(theme?.sectionLabel).toBe("Settings › General")

    // Individual keybinding rows are intentionally excluded from the palette
    expect(ids.some((id) => id.startsWith("settings-row-keybinding-"))).toBe(false)
  })

  test("rows are searchable by description keywords", () => {
    const entries = getSettingsPaletteEntries()
    const results = searchSettingsEntries(entries, "dark mode")
    expect(results.map((entry) => entry.id)).toContain("settings-row-theme")
  })
})
