import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import {
  Archive,
  Box,
  Check,
  ExternalLink,
  FolderGit2,
  FolderPlus,
  GitBranch,
  GitFork,
  Globe,
  History,
  House,
  ListTodo,
  LockOpen,
  MessageSquarePlus,
  Paperclip,
  Settings2,
  Share2,
  SquareKanban,
  SquareTerminal,
} from "lucide-react"
import { REQUEST_ATTACH_FILES_EVENT } from "../../app/chatFocusPolicy"
import type { KannaState } from "../../app/useKannaState"
import { actionMatchesEvent, getBindingsForAction } from "../../lib/keybindings"
import { NEW_CHAT_COMPOSER_ID, useChatPreferencesStore } from "../../stores/chatPreferencesStore"
import { useRightSidebarStore } from "../../stores/rightSidebarStore"
import { useTerminalLayoutStore } from "../../stores/terminalLayoutStore"
import { useTerminalPreferencesStore } from "../../stores/terminalPreferencesStore"
import { getOpenAppItems, openAppValue, OpenAppIcon } from "../open-external-menu"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command"
import { Kbd, KbdGroup } from "../ui/kbd"
import {
  flattenPaletteProjects,
  flattenSidebarThreads,
  getRecentThreads,
  getSettingsPaletteEntries,
  scorePaletteItem,
  searchProjects,
  searchSettingsEntries,
  searchThreadsByTitle,
  type PaletteProject,
  type PaletteThread,
} from "./actions"

type PalettePage = "models" | "new-thread" | "open-in"

interface PaletteAction {
  id: string
  title: string
  keywords: string[]
  icon: ReactNode
  /** First keybinding rendered as a shortcut hint, e.g. "cmd+j". */
  shortcut?: string
  run: () => void
}

function ShortcutHint({ binding }: { binding: string }) {
  return (
    <KbdGroup className="ml-auto">
      {binding.split("+").map((key, index) => (
        <Kbd key={`${key}-${index}`}>{key.toUpperCase()}</Kbd>
      ))}
    </KbdGroup>
  )
}

function statusDotClass(archived: boolean) {
  return archived ? "text-muted-foreground/50" : "text-muted-foreground"
}

function ThreadItem({
  thread,
  onSelect,
}: {
  thread: PaletteThread
  onSelect: (thread: PaletteThread) => void
}) {
  return (
    <CommandItem value={`thread-${thread.chatId}`} onSelect={() => onSelect(thread)}>
      <MessageSquarePlus className={`h-4 w-4 ${statusDotClass(thread.archived)}`} />
      <span className="min-w-0 truncate">{thread.title}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-3 text-xs text-muted-foreground">
        {thread.archived ? (
          <span className="rounded border border-border px-1 py-px text-[10px] uppercase tracking-wide">Archived</span>
        ) : null}
        <span className="max-w-[140px] truncate">{thread.projectTitle}</span>
      </span>
    </CommandItem>
  )
}

const ICON_CLASS = "h-4 w-4 text-muted-foreground"

export function CommandPalette({ state }: { state: KannaState }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [pages, setPages] = useState<PalettePage[]>([])
  const [query, setQuery] = useState("")
  const page: PalettePage | "root" = pages.length > 0 ? pages[pages.length - 1] : "root"

  const editorPreset = useTerminalPreferencesStore((store) => store.editorPreset)
  const editorCommandTemplate = useTerminalPreferencesStore((store) => store.editorCommandTemplate)

  const composerChatId = state.activeChatId ?? NEW_CHAT_COMPOSER_ID
  const composerStateSlice = useChatPreferencesStore((store) => store.chatStates[composerChatId])
  const composerState = useMemo(
    () => composerStateSlice ?? useChatPreferencesStore.getState().getComposerState(composerChatId),
    [composerChatId, composerStateSlice]
  )

  const onChatPage = Boolean(state.activeChatId)
  const projectId = state.activeProjectId
  const isMac = (state.localProjects?.machine.platform ?? "darwin") === "darwin"
  const currentChatRow = useMemo(() => {
    if (!state.activeChatId) return null
    for (const group of state.sidebarData.projectGroups) {
      const row = group.chats.find((chat) => chat.chatId === state.activeChatId)
      if (row) return row
    }
    return null
  }, [state.activeChatId, state.sidebarData])

  const providerConfig = useMemo(
    () => state.availableProviders.find((provider) => provider.id === composerState.provider)
      ?? state.availableProviders[0],
    [composerState.provider, state.availableProviders]
  )

  const threads = useMemo(() => flattenSidebarThreads(state.sidebarData), [state.sidebarData])
  const paletteProjects = useMemo(
    () => flattenPaletteProjects(state.sidebarData, state.localProjects?.projects ?? []),
    [state.localProjects, state.sidebarData]
  )
  const settingsEntries = useMemo(() => getSettingsPaletteEntries(), [])

  const close = useCallback(() => setOpen(false), [])

  const openPalette = useCallback(() => {
    setPages([])
    setQuery("")
    setOpen(true)
  }, [])

  const pushPage = useCallback((next: PalettePage) => {
    setPages((current) => [...current, next])
    setQuery("")
  }, [])

  const popPage = useCallback(() => {
    setPages((current) => current.slice(0, -1))
    setQuery("")
  }, [])

  useEffect(() => {
    function handleGlobalKeydown(event: KeyboardEvent) {
      if (!actionMatchesEvent(state.keybindings, "openCommandPalette", event)) return
      event.preventDefault()
      if (open) {
        setOpen(false)
        return
      }
      openPalette()
    }

    window.addEventListener("keydown", handleGlobalKeydown)
    return () => window.removeEventListener("keydown", handleGlobalKeydown)
  }, [open, openPalette, state.keybindings])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      openPalette()
      return
    }
    setOpen(false)
  }, [openPalette])

  const openThread = useCallback((thread: PaletteThread) => {
    close()
    if (thread.archived) {
      void state.handleOpenArchivedChat(thread.chatId)
      return
    }
    navigate(`/chat/${thread.chatId}`)
  }, [close, navigate, state.handleOpenArchivedChat])

  const openProject = useCallback((project: PaletteProject) => {
    close()
    if (project.mostRecentChatId) {
      navigate(`/chat/${project.mostRecentChatId}`)
      return
    }
    if (project.projectId) {
      void state.handleCreateChat(project.projectId)
      return
    }
    void state.handleOpenLocalProject(project.localPath)
  }, [close, navigate, state.handleCreateChat, state.handleOpenLocalProject])

  const openGitPanel = useCallback((viewMode: "changes" | "history") => {
    if (!projectId) return
    const store = useRightSidebarStore.getState()
    const currentPanel = store.projects[projectId]?.rightPanel ?? "hidden"
    if (currentPanel !== "git") {
      store.togglePanel(projectId, "git")
    }
    store.setViewMode(projectId, viewMode)
  }, [projectId])

  const actions = useMemo<PaletteAction[]>(() => {
    const list: PaletteAction[] = []
    const chatShortcuts = (action: Parameters<typeof getBindingsForAction>[1]) =>
      getBindingsForAction(state.keybindings, action)[0]

    if (projectId) {
      list.push({
        id: "new-thread-current",
        title: "New Thread in Current Project",
        keywords: ["create chat", "compose", "start"],
        icon: <MessageSquarePlus className={ICON_CLASS} />,
        shortcut: chatShortcuts("createChatInCurrentProject"),
        run: () => {
          close()
          void state.handleCreateChat(projectId)
        },
      })
    }

    if (state.sidebarData.projectGroups.length > 0) {
      list.push({
        id: "new-thread-choose",
        title: "New Thread in…",
        keywords: ["create chat", "compose", "start", "project"],
        icon: <MessageSquarePlus className={ICON_CLASS} />,
        run: () => pushPage("new-thread"),
      })
    }

    list.push({
      id: "new-project",
      title: "New Project…",
      keywords: ["create", "add", "open folder", "clone", "repo"],
      icon: <FolderPlus className={ICON_CLASS} />,
      shortcut: chatShortcuts("openAddProject"),
      run: () => {
        close()
        navigate("/")
        state.openAddProjectModal()
      },
    })

    list.push({
      id: "go-board",
      title: "Go to Board",
      keywords: ["kanban", "navigate", "tasks"],
      icon: <SquareKanban className={ICON_CLASS} />,
      run: () => {
        close()
        navigate("/board")
      },
    })

    list.push({
      id: "go-home",
      title: "Go to Projects",
      keywords: ["home", "navigate", "local projects"],
      icon: <House className={ICON_CLASS} />,
      run: () => {
        close()
        navigate("/")
      },
    })

    if (onChatPage && projectId) {
      list.push({
        id: "git-changes",
        title: "Open Git Changes",
        keywords: ["diff", "commit", "stage", "source control"],
        icon: <GitBranch className={ICON_CLASS} />,
        shortcut: chatShortcuts("toggleRightSidebar"),
        run: () => {
          close()
          openGitPanel("changes")
        },
      })
      list.push({
        id: "git-history",
        title: "Open Git History",
        keywords: ["commits", "log", "source control"],
        icon: <History className={ICON_CLASS} />,
        run: () => {
          close()
          openGitPanel("history")
        },
      })
      list.push({
        id: "browser-panel",
        title: "Open Browser Panel",
        keywords: ["preview", "localhost", "web"],
        icon: <Globe className={ICON_CLASS} />,
        run: () => {
          close()
          const store = useRightSidebarStore.getState()
          const currentPanel = store.projects[projectId]?.rightPanel ?? "hidden"
          if (currentPanel !== "browser") {
            store.togglePanel(projectId, "browser")
          }
        },
      })
      list.push({
        id: "toggle-terminal",
        title: "Toggle Terminal",
        keywords: ["shell", "console", "embedded"],
        icon: <SquareTerminal className={ICON_CLASS} />,
        shortcut: chatShortcuts("toggleEmbeddedTerminal"),
        run: () => {
          close()
          const store = useTerminalLayoutStore.getState()
          const layout = store.projects[projectId]
          if (!layout || layout.terminals.length === 0) {
            store.addTerminal(projectId)
            return
          }
          store.toggleVisibility(projectId)
        },
      })
      list.push({
        id: "open-in",
        title: "Open in…",
        keywords: ["editor", "finder", "terminal", "external", "cursor", "xcode", "reveal"],
        icon: <ExternalLink className={ICON_CLASS} />,
        shortcut: chatShortcuts("openInEditor"),
        run: () => pushPage("open-in"),
      })
    }

    if (state.activeChatId) {
      list.push({
        id: "share-chat",
        title: "Share Chat",
        keywords: ["export", "link", "standalone", "transcript"],
        icon: <Share2 className={ICON_CLASS} />,
        run: () => {
          close()
          void state.handleShareChat(state.activeChatId)
        },
      })
      if (currentChatRow && currentChatRow.canFork !== false) {
        list.push({
          id: "fork-chat",
          title: "Fork Chat",
          keywords: ["duplicate", "branch", "copy"],
          icon: <GitFork className={ICON_CLASS} />,
          run: () => {
            close()
            void state.handleForkChat(currentChatRow)
          },
        })
      }
      if (currentChatRow) {
        list.push({
          id: "archive-chat",
          title: "Archive Chat",
          keywords: ["hide", "close", "done"],
          icon: <Archive className={ICON_CLASS} />,
          run: () => {
            close()
            void state.handleArchiveChat(currentChatRow)
          },
        })
      }
    }

    if (onChatPage) {
      list.push({
        id: "change-model",
        title: "Change Model…",
        keywords: ["llm", "switch", composerState.model, providerConfig?.label ?? ""],
        icon: <Box className={ICON_CLASS} />,
        run: () => pushPage("models"),
      })
      if (providerConfig?.supportsPlanMode) {
        list.push(composerState.planMode
          ? {
            id: "full-access",
            title: "Switch to Full Access",
            keywords: ["plan mode", "permission", "execute", "yolo"],
            icon: <LockOpen className={ICON_CLASS} />,
            run: () => {
              close()
              useChatPreferencesStore.getState().setChatComposerPlanMode(composerChatId, false)
            },
          }
          : {
            id: "plan-mode",
            title: "Switch to Plan Mode",
            keywords: ["full access", "permission", "review", "safe"],
            icon: <ListTodo className={ICON_CLASS} />,
            run: () => {
              close()
              useChatPreferencesStore.getState().setChatComposerPlanMode(composerChatId, true)
            },
          })
      }
      list.push({
        id: "attach-files",
        title: "Attach Files",
        keywords: ["upload", "image", "screenshot", "paperclip", "add attachment"],
        icon: <Paperclip className={ICON_CLASS} />,
        run: () => {
          close()
          window.dispatchEvent(new CustomEvent(REQUEST_ATTACH_FILES_EVENT))
        },
      })
    }

    return list
  }, [
    close,
    composerChatId,
    composerState.model,
    composerState.planMode,
    currentChatRow,
    navigate,
    onChatPage,
    openGitPanel,
    projectId,
    providerConfig,
    pushPage,
    state.activeChatId,
    state.handleArchiveChat,
    state.handleCreateChat,
    state.handleForkChat,
    state.handleShareChat,
    state.keybindings,
    state.openAddProjectModal,
    state.sidebarData.projectGroups.length,
  ])

  const trimmedQuery = query.trim()

  const rankedActions = useMemo(() => {
    if (!trimmedQuery) return actions.map((action) => ({ action, score: 1 }))
    return actions
      .map((action) => ({ action, score: scorePaletteItem(trimmedQuery, action.title, action.keywords) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
  }, [actions, trimmedQuery])

  const settingsResults = useMemo(
    () => (trimmedQuery ? searchSettingsEntries(settingsEntries, trimmedQuery) : []),
    [settingsEntries, trimmedQuery]
  )

  const threadResults = useMemo(
    () => (trimmedQuery
      ? searchThreadsByTitle(threads, trimmedQuery)
      : getRecentThreads(threads).map((thread) => ({ ...thread, score: 1 }))),
    [threads, trimmedQuery]
  )

  const projectSearchResults = useMemo(
    () => (trimmedQuery ? searchProjects(paletteProjects, trimmedQuery) : []),
    [paletteProjects, trimmedQuery]
  )

  const modelResults = useMemo(() => {
    if (page !== "models") return []
    const models = providerConfig?.models ?? []
    if (!trimmedQuery) return models
    return models
      .map((model) => ({ model, score: scorePaletteItem(trimmedQuery, model.label, [model.id]) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.model)
  }, [page, providerConfig, trimmedQuery])

  const projectResults = useMemo(() => {
    if (page !== "new-thread") return []
    const groups = state.sidebarData.projectGroups
    if (!trimmedQuery) return groups
    return groups
      .map((group) => ({ group, score: scorePaletteItem(trimmedQuery, group.title, [group.localPath]) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.group)
  }, [page, state.sidebarData.projectGroups, trimmedQuery])

  const openInResults = useMemo(() => {
    if (page !== "open-in") return []
    const items = getOpenAppItems({ editorPreset, isMac, includeFinder: true, includeTerminal: true })
    if (!trimmedQuery) return items
    return items
      .map((item) => ({ item, score: scorePaletteItem(trimmedQuery, item.label) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.item)
  }, [editorPreset, isMac, page, trimmedQuery])

  const inputPlaceholder = page === "models"
    ? `Search ${providerConfig?.label ?? "provider"} models…`
    : page === "new-thread"
      ? "Choose a project…"
      : page === "open-in"
        ? "Open project in…"
        : "Type a command or search threads…"

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      onEscapeKeyDown={(event) => {
        if (pages.length === 0) return
        event.preventDefault()
        popPage()
      }}
    >
      <Command
        shouldFilter={false}
        onKeyDown={(event) => {
          if (event.key === "Backspace" && !query && pages.length > 0) {
            event.preventDefault()
            popPage()
          }
        }}
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={inputPlaceholder}
          autoFocus
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {page === "root" ? (() => {
            const threadsGroup = threadResults.length > 0 ? (
              <CommandGroup key="threads" heading={trimmedQuery ? "Threads" : "Recent Threads"}>
                {threadResults.map((thread) => (
                  <ThreadItem key={thread.chatId} thread={thread} onSelect={openThread} />
                ))}
              </CommandGroup>
            ) : null

            const actionsGroup = rankedActions.length > 0 ? (
              <CommandGroup key="actions" heading="Actions">
                {rankedActions.map(({ action }) => (
                  <CommandItem key={action.id} value={`action-${action.id}`} onSelect={action.run}>
                    {action.icon}
                    <span className="min-w-0 truncate">{action.title}</span>
                    {action.shortcut ? <ShortcutHint binding={action.shortcut} /> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null

            const projectsGroup = projectSearchResults.length > 0 ? (
              <CommandGroup key="projects" heading="Projects">
                {projectSearchResults.map((project) => (
                  <CommandItem
                    key={project.localPath}
                    value={`palette-project-${project.localPath}`}
                    onSelect={() => openProject(project)}
                  >
                    <FolderGit2 className={ICON_CLASS} />
                    <span className="min-w-0 truncate">{project.title}</span>
                    <span className="ml-auto shrink-0 pl-3 text-xs text-muted-foreground">
                      {project.mostRecentChatId ? "Open latest chat" : "New chat"}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null

            const settingsGroup = settingsResults.length > 0 ? (
              <CommandGroup key="settings" heading="Settings">
                {settingsResults.map((entry) => (
                  <CommandItem
                    key={entry.id}
                    value={`setting-${entry.id}`}
                    onSelect={() => {
                      close()
                      navigate(entry.path)
                    }}
                  >
                    <Settings2 className={ICON_CLASS} />
                    <span className="min-w-0 truncate">{entry.title}</span>
                    <span className="ml-auto shrink-0 pl-3 text-xs text-muted-foreground">{entry.sectionLabel}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null

            // Empty query = quick switcher (Enter jumps to the most recent
            // thread). Typing = groups ordered by their best match, so the
            // most relevant kind of result floats to the top; ties keep the
            // declared order (actions, projects, settings, threads) via
            // stable sort.
            if (!trimmedQuery) {
              return [threadsGroup, actionsGroup]
            }

            return [
              { node: actionsGroup, topScore: rankedActions[0]?.score ?? 0 },
              { node: projectsGroup, topScore: projectSearchResults[0]?.score ?? 0 },
              { node: settingsGroup, topScore: settingsResults[0]?.score ?? 0 },
              { node: threadsGroup, topScore: threadResults[0]?.score ?? 0 },
            ]
              .filter((group) => group.node !== null)
              .sort((left, right) => right.topScore - left.topScore)
              .map((group) => group.node)
          })() : null}

          {page === "models" ? (
            <CommandGroup heading={`${providerConfig?.label ?? "Provider"} Models`}>
              {modelResults.map((model) => (
                <CommandItem
                  key={model.id}
                  value={`model-${model.id}`}
                  onSelect={() => {
                    close()
                    useChatPreferencesStore.getState().setChatComposerModel(composerChatId, model.id)
                  }}
                >
                  <Box className={ICON_CLASS} />
                  <span className="min-w-0 truncate">{model.label}</span>
                  {composerState.model === model.id ? <Check className="ml-auto h-4 w-4 text-muted-foreground" /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {page === "new-thread" ? (
            <CommandGroup heading="New Thread In">
              {projectResults.map((group) => (
                <CommandItem
                  key={group.groupKey}
                  value={`project-${group.groupKey}`}
                  onSelect={() => {
                    close()
                    void state.handleCreateChat(group.groupKey)
                  }}
                >
                  <FolderGit2 className={ICON_CLASS} />
                  <span className="min-w-0 truncate">{group.title}</span>
                  <span className="ml-auto max-w-[220px] shrink-0 truncate pl-3 text-xs text-muted-foreground">{group.localPath}</span>
                </CommandItem>
              ))}
              {!trimmedQuery || scorePaletteItem(trimmedQuery, "New Project…", ["create", "add"]) > 0 ? (
                <CommandItem
                  value="project-new"
                  onSelect={() => {
                    close()
                    navigate("/")
                    state.openAddProjectModal()
                  }}
                >
                  <FolderPlus className={ICON_CLASS} />
                  <span>New Project…</span>
                </CommandItem>
              ) : null}
            </CommandGroup>
          ) : null}

          {page === "open-in" ? (
            <CommandGroup heading="Open Project In">
              {openInResults.map((item) => (
                <CommandItem
                  key={item.value}
                  value={`open-${item.value}`}
                  onSelect={() => {
                    close()
                    openAppValue({
                      value: item.value,
                      editorCommandTemplate,
                      onOpenExternal: (action, editor) => {
                        void state.handleOpenExternal(action, editor)
                      },
                    })
                  }}
                >
                  <OpenAppIcon value={item.value} isMac={isMac} className="h-4 w-4" />
                  <span>{item.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
