import { describe, expect, test } from "bun:test"
import type { SidebarChatRow, SidebarData } from "../../shared/types"
import {
  computeThreadSections,
  flattenSidebarThreads,
  getInProgressThreads,
  getRecentThreads,
  getReviewThreads,
  RECENT_THREADS_LIMIT,
} from "./thread-sections"

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

/** One project group wrapping the given rows (last one archived when `archived` set). */
function makeData(chats: SidebarChatRow[], archivedChats: SidebarChatRow[] = []): SidebarData {
  return {
    projectGroups: [
      {
        groupKey: "p",
        title: "P",
        realTitle: "P",
        localPath: "/tmp/p",
        chats,
        previewChats: [],
        olderChats: [],
        archivedChats,
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
    const data = makeData(
      [
        makeChatRow({ chatId: "waiting", title: "Waiting", status: "waiting_for_user", lastMessageAt: 300 }),
        makeChatRow({ chatId: "unread", title: "Unread", unread: true, lastMessageAt: 600 }),
        makeChatRow({ chatId: "idle", title: "Idle", lastMessageAt: 900 }),
        makeChatRow({ chatId: "running", title: "Running", status: "running", lastMessageAt: 950 }),
      ],
      [makeChatRow({ chatId: "archived-unread", title: "Archived", unread: true, lastMessageAt: 990 })],
    )
    const review = getReviewThreads(flattenSidebarThreads(data))
    // unread (600) before waiting (300); idle, running, and archived excluded.
    expect(review.map((thread) => thread.chatId)).toEqual(["unread", "waiting"])
  })
})

describe("getInProgressThreads", () => {
  test("selects running/starting chats, most recent first, excluding archived", () => {
    const data = makeData(
      [
        makeChatRow({ chatId: "running", title: "Running", status: "running", lastMessageAt: 300 }),
        makeChatRow({ chatId: "starting", title: "Starting", status: "starting", lastMessageAt: 600 }),
        makeChatRow({ chatId: "idle", title: "Idle", lastMessageAt: 900 }),
      ],
      [makeChatRow({ chatId: "archived-running", title: "Archived", status: "running", lastMessageAt: 990 })],
    )
    const inProgress = getInProgressThreads(flattenSidebarThreads(data))
    expect(inProgress.map((thread) => thread.chatId)).toEqual(["starting", "running"])
  })

  test("excludes chatIds passed in the exclude set", () => {
    const data = makeData([
      makeChatRow({ chatId: "running-1", title: "One", status: "running", lastMessageAt: 300 }),
      makeChatRow({ chatId: "running-2", title: "Two", status: "running", lastMessageAt: 600 }),
    ])
    const inProgress = getInProgressThreads(flattenSidebarThreads(data), new Set(["running-2"]))
    expect(inProgress.map((thread) => thread.chatId)).toEqual(["running-1"])
  })
})

describe("computeThreadSections", () => {
  test("a running unread chat lands in review, not in progress", () => {
    const data = makeData([
      makeChatRow({ chatId: "running-unread", title: "Both", status: "running", unread: true, lastMessageAt: 300 }),
      makeChatRow({ chatId: "running", title: "Running", status: "running", lastMessageAt: 600 }),
    ])
    const sections = computeThreadSections(flattenSidebarThreads(data))
    expect(sections.review.map((thread) => thread.chatId)).toEqual(["running-unread"])
    expect(sections.inProgress.map((thread) => thread.chatId)).toEqual(["running"])
  })

  test("recents excludes review and in-progress chats and hides empty new chats", () => {
    const data = makeData([
      makeChatRow({ chatId: "unread", title: "Unread", unread: true, lastMessageAt: 900 }),
      makeChatRow({ chatId: "running", title: "Running", status: "running", lastMessageAt: 800 }),
      makeChatRow({ chatId: "idle", title: "Idle", lastMessageAt: 700 }),
      makeChatRow({ chatId: "empty-draft", title: "Draft" }), // no lastMessageAt
    ])
    const sections = computeThreadSections(flattenSidebarThreads(data))
    expect(sections.recent.map((thread) => thread.chatId)).toEqual(["idle"])
  })

  test("recents is always capped at RECENT_THREADS_LIMIT, with or without other sections", () => {
    const idleChats = Array.from({ length: RECENT_THREADS_LIMIT + 2 }, (_, index) =>
      makeChatRow({ chatId: `idle-${index}`, title: `Idle ${index}`, lastMessageAt: 100 + index }))

    const withoutOthers = computeThreadSections(flattenSidebarThreads(makeData(idleChats)))
    expect(withoutOthers.review).toHaveLength(0)
    expect(withoutOthers.inProgress).toHaveLength(0)
    expect(withoutOthers.recent).toHaveLength(RECENT_THREADS_LIMIT)

    const withOthers = computeThreadSections(flattenSidebarThreads(makeData([
      ...idleChats,
      makeChatRow({ chatId: "unread", title: "Unread", unread: true, lastMessageAt: 900 }),
      makeChatRow({ chatId: "running", title: "Running", status: "running", lastMessageAt: 800 }),
    ])))
    expect(withOthers.recent).toHaveLength(RECENT_THREADS_LIMIT)
  })
})
