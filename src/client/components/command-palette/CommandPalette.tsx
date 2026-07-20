import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import {
  Archive,
  Box,
  Brain,
  Check,
  Copy,
  ExternalLink,
  FolderGit2,
  FolderPlus,
  Gauge,
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
  SquareMenu,
  SquareTerminal,
} from "lucide-react"
import type { ClaudeContextWindow } from "../../../shared/types"
import { REQUEST_ATTACH_FILES_EVENT } from "../../app/chatFocusPolicy"
import type { KannaState } from "../../app/useKannaState"
import { useComposer } from "../../hooks/useComposer"
import { formatSidebarAgeLabel } from "../../lib/formatters"
import { actionMatchesEvent, getBindingsForAction } from "../../lib/keybindings"
import { useRightSidebarStore } from "../../stores/rightSidebarStore"
import { useTerminalLayoutStore } from "../../stores/terminalLayoutStore"
import { useTerminalPreferencesStore } from "../../stores/terminalPreferencesStore"
import { PROVIDER_ICONS } from "../chat-ui/ChatPreferenceControls"
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

type PalettePage = "models" | "harness" | "new-thread" | "open-in" | "settings"

interface PaletteAction {
  id: string
  title: string
  keywords: string[]
  icon: ReactNode
  /** First keybinding rendered as a shortcut hint, e.g. "cmd+j". */
  shortcut?: string
  /** Muted trailing label (e.g. "Model", "Harness"). Ignored when `shortcut` is set. */
  hint?: string
  /** Only surfaced while the user is typing — keeps the empty-query list curated. */
  searchOnly?: boolean
  run: () => void
}

function ShortcutHint({ binding }: { binding: string }) {
  return (
    <span className="ml-auto shrink-0 pl-3 text-xs text-muted-foreground">
      {binding.toUpperCase()}
    </span>
  )
}

function statusDotClass(archived: boolean) {
  return archived ? "text-muted-foreground/50" : "text-muted-foreground"
}

function ThreadItem({
  thread,
  nowMs,
  onSelect,
}: {
  thread: PaletteThread
  nowMs: number
  onSelect: (thread: PaletteThread) => void
}) {
  // Same relative-age formatting and timestamp source as the sidebar rows.
  const ageLabel = formatSidebarAgeLabel(thread.lastActivityAt, nowMs)
  return (
    <CommandItem value={`thread-${thread.chatId}`} onSelect={() => onSelect(thread)}>
      <MessageSquarePlus className={`h-4 w-4 ${statusDotClass(thread.archived)}`} />
      <span className="min-w-0 truncate">{thread.title}</span>
      {ageLabel ? (
        // Counteract part of the CommandItem flex gap so the age hugs the title.
        <span className="-ml-1 shrink-0 text-xs text-muted-foreground">
          {ageLabel === "now" ? ageLabel : `${ageLabel} ago`}
        </span>
      ) : null}
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

  // Canonical composer semantics shared with ChatInput: provider is locked
  // once the chat's session has started, models come from the provider
  // catalog, plan mode only where supported.
  const composer = useComposer({
    chatId: state.activeChatId,
    activeProvider: state.runtime?.provider ?? null,
    availableProviders: state.availableProviders,
  })

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

  // Anchor for relative thread ages; refreshed each time the palette opens.
  const nowMs = useMemo(() => Date.now(), [open])
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

    list.push({
      id: "settings",
      title: "Settings…",
      keywords: ["preferences", "config", "options", "theme", "keybindings", "providers", "general"],
      icon: <Settings2 className={ICON_CLASS} />,
      run: () => pushPage("settings"),
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
      if (state.navbarLocalPath) {
        const projectPath = state.navbarLocalPath
        list.push({
          id: "copy-project-path",
          title: "Copy Path",
          keywords: ["copy project path", "clipboard", "directory", "folder", projectPath],
          icon: <Copy className={ICON_CLASS} />,
          run: () => {
            close()
            void state.handleCopyPath(projectPath)
          },
        })
      }
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
        keywords: ["llm", "switch", composer.effectiveState.model, composer.providerConfig?.label ?? ""],
        icon: <Box className={ICON_CLASS} />,
        run: () => pushPage("models"),
      })
      if (composer.canChangeProvider && state.availableProviders.length > 1) {
        list.push({
          id: "change-harness",
          title: "Switch Harness…",
          keywords: ["provider", "agent", "claude code", "codex", "cursor", "pi", "change provider"],
          icon: <Box className={ICON_CLASS} />,
          run: () => pushPage("harness"),
        })
      }
      // Option controls come from the same central availability registry
      // (lib/composer.ts deriveComposerOptionControls) that drives the chat
      // input's ChatPreferenceControls — nothing unavailable is ever offered.
      const { planMode, fastMode, reasoning, contextWindow } = composer.optionControls
      if (planMode) {
        list.push(planMode.enabled
          ? {
            id: "full-access",
            title: "Switch to Full Access",
            keywords: ["plan mode", "permission", "execute", "yolo"],
            icon: <LockOpen className={ICON_CLASS} />,
            run: () => {
              close()
              composer.setPlanMode(false)
            },
          }
          : {
            id: "plan-mode",
            title: "Switch to Plan Mode",
            keywords: ["full access", "permission", "review", "safe"],
            icon: <ListTodo className={ICON_CLASS} />,
            run: () => {
              close()
              composer.setPlanMode(true)
            },
          })
      }
      if (fastMode) {
        list.push(fastMode.enabled
          ? {
            id: "standard-mode",
            title: "Switch to Standard Mode",
            keywords: ["fast mode", "speed", "service tier"],
            icon: <Gauge className={`${ICON_CLASS} -scale-x-100`} />,
            run: () => {
              close()
              composer.setFastMode(false)
            },
          }
          : {
            id: "fast-mode",
            title: "Switch to Fast Mode",
            keywords: ["standard", "speed", "service tier"],
            icon: <Gauge className={ICON_CLASS} />,
            run: () => {
              close()
              composer.setFastMode(true)
            },
          })
      }
      if (reasoning) {
        for (const option of reasoning.options) {
          if (option.disabled) continue
          const isCurrent = reasoning.selectedId === option.id
          list.push({
            id: `set-reasoning-${option.id}`,
            title: `Reasoning: ${option.label}`,
            keywords: ["reasoning", "effort", "thinking", option.id],
            icon: <Brain className={ICON_CLASS} />,
            hint: isCurrent ? "Current effort" : option.description ?? "Reasoning effort",
            searchOnly: true,
            run: () => {
              close()
              composer.setReasoningEffort(option.id)
            },
          })
        }
      }
      if (contextWindow) {
        for (const option of contextWindow.options) {
          const isCurrent = contextWindow.selectedId === option.id
          list.push({
            id: `set-context-${option.id}`,
            title: `Context Window: ${option.label}`,
            keywords: ["context window", "context length", "tokens", option.id],
            icon: <SquareMenu className={ICON_CLASS} />,
            hint: isCurrent ? "Current window" : "Context window",
            searchOnly: true,
            run: () => {
              close()
              composer.setContextWindow(option.id as ClaudeContextWindow)
            },
          })
        }
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

      // Direct model/harness switches: every allowed target is itself a
      // searchable action (surfaced only while typing), on top of the
      // "Change Model…"/"Switch Harness…" sub-pages. Availability rules come
      // from the same composer controller, so nothing invalid is offered.
      const providerLabel = composer.providerConfig?.label ?? composer.selectedProvider
      for (const model of composer.models) {
        const isCurrent = composer.effectiveState.model === model.id
        list.push({
          id: `set-model-${model.id}`,
          title: model.label,
          keywords: [model.id, "model", "switch model", providerLabel],
          icon: <Box className={ICON_CLASS} />,
          hint: isCurrent ? "Current model" : `${providerLabel} model`,
          searchOnly: true,
          run: () => {
            close()
            composer.selectModel(model.id)
          },
        })
      }
      if (composer.canChangeProvider) {
        for (const provider of state.availableProviders) {
          if (provider.id === composer.selectedProvider) continue
          const ProviderIcon = PROVIDER_ICONS[provider.id]
          list.push({
            id: `set-harness-${provider.id}`,
            title: `Switch to ${provider.label}`,
            keywords: [provider.id, "harness", "provider", "agent"],
            icon: <ProviderIcon className={ICON_CLASS} />,
            hint: "Harness",
            searchOnly: true,
            run: () => {
              close()
              composer.selectProvider(provider.id)
            },
          })
        }
      }
    }

    return list
  }, [
    close,
    composer,
    currentChatRow,
    navigate,
    onChatPage,
    openGitPanel,
    projectId,
    pushPage,
    state.activeChatId,
    state.availableProviders,
    state.handleArchiveChat,
    state.handleCopyPath,
    state.handleCreateChat,
    state.handleForkChat,
    state.handleShareChat,
    state.keybindings,
    state.navbarLocalPath,
    state.openAddProjectModal,
    state.sidebarData.projectGroups.length,
  ])

  const trimmedQuery = query.trim()

  const rankedActions = useMemo(() => {
    if (!trimmedQuery) {
      return actions
        .filter((action) => !action.searchOnly)
        .map((action) => ({ action, score: 1 }))
    }
    return actions
      .map((action) => ({ action, score: scorePaletteItem(trimmedQuery, action.title, action.keywords) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
  }, [actions, trimmedQuery])

  // Settings live only behind the "Settings…" sub-page, never in root results.
  const settingsResults = useMemo(() => {
    if (page !== "settings") return []
    if (!trimmedQuery) return settingsEntries
    return searchSettingsEntries(settingsEntries, trimmedQuery, settingsEntries.length)
  }, [page, settingsEntries, trimmedQuery])

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
    if (!trimmedQuery) return composer.models
    return composer.models
      .map((model) => ({ model, score: scorePaletteItem(trimmedQuery, model.label, [model.id]) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.model)
  }, [composer.models, page, trimmedQuery])

  const harnessResults = useMemo(() => {
    if (page !== "harness") return []
    if (!trimmedQuery) return state.availableProviders
    return state.availableProviders
      .map((provider) => ({ provider, score: scorePaletteItem(trimmedQuery, provider.label, [provider.id]) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.provider)
  }, [page, state.availableProviders, trimmedQuery])

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
    ? `Search ${composer.providerConfig?.label ?? "provider"} models…`
    : page === "harness"
      ? "Choose a harness…"
      : page === "new-thread"
        ? "Choose a project…"
        : page === "open-in"
          ? "Open project in…"
          : page === "settings"
            ? "Search settings…"
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
                  <ThreadItem key={thread.chatId} thread={thread} nowMs={nowMs} onSelect={openThread} />
                ))}
              </CommandGroup>
            ) : null

            const actionsGroup = rankedActions.length > 0 ? (
              <CommandGroup key="actions" heading="Actions">
                {rankedActions.map(({ action }) => (
                  <CommandItem key={action.id} value={`action-${action.id}`} onSelect={action.run}>
                    {action.icon}
                    <span className="min-w-0 truncate">{action.title}</span>
                    {action.shortcut ? (
                      <ShortcutHint binding={action.shortcut} />
                    ) : action.hint ? (
                      <span className="ml-auto shrink-0 pl-3 text-xs text-muted-foreground">{action.hint}</span>
                    ) : null}
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

            // Empty query = quick switcher (Enter jumps to the most recent
            // thread). Typing = groups ordered by their best match, so the
            // most relevant kind of result floats to the top; ties keep the
            // declared order (actions, projects, threads) via stable sort.
            if (!trimmedQuery) {
              return [threadsGroup, actionsGroup]
            }

            return [
              { node: actionsGroup, topScore: rankedActions[0]?.score ?? 0 },
              { node: projectsGroup, topScore: projectSearchResults[0]?.score ?? 0 },
              { node: threadsGroup, topScore: threadResults[0]?.score ?? 0 },
            ]
              .filter((group) => group.node !== null)
              .sort((left, right) => right.topScore - left.topScore)
              .map((group) => group.node)
          })() : null}

          {page === "settings" ? (
            <CommandGroup heading="Settings">
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
          ) : null}

          {page === "models" ? (
            <CommandGroup heading={`${composer.providerConfig?.label ?? "Provider"} Models`}>
              {modelResults.map((model) => (
                <CommandItem
                  key={model.id}
                  value={`model-${model.id}`}
                  onSelect={() => {
                    close()
                    composer.selectModel(model.id)
                  }}
                >
                  <Box className={ICON_CLASS} />
                  <span className="min-w-0 truncate">{model.label}</span>
                  {composer.effectiveState.model === model.id ? <Check className="ml-auto h-4 w-4 text-muted-foreground" /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {page === "harness" ? (
            <CommandGroup heading="Harness">
              {harnessResults.map((provider) => {
                const ProviderIcon = PROVIDER_ICONS[provider.id]
                return (
                  <CommandItem
                    key={provider.id}
                    value={`harness-${provider.id}`}
                    onSelect={() => {
                      close()
                      composer.selectProvider(provider.id)
                    }}
                  >
                    <ProviderIcon className={ICON_CLASS} />
                    <span className="min-w-0 truncate">{provider.label}</span>
                    {composer.selectedProvider === provider.id ? <Check className="ml-auto h-4 w-4 text-muted-foreground" /> : null}
                  </CommandItem>
                )
              })}
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
