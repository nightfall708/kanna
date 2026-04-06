import { PatchDiff } from "@pierre/diffs/react"
import { ChevronDown, ChevronUp, Columns2, ExternalLink, Rows3, WrapText, X } from "lucide-react"
import { memo, useEffect, useState, type ReactNode } from "react"
import type { ChatDiffSnapshot } from "../../../shared/types"
import { cn } from "../../lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"

type DiffRenderMode = "unified" | "split"

interface RightSidebarProps {
  diffs: ChatDiffSnapshot
  diffRenderMode: DiffRenderMode
  wrapLines: boolean
  onOpenFile: (path: string) => void
  onDiffRenderModeChange: (mode: DiffRenderMode) => void
  onWrapLinesChange: (wrap: boolean) => void
  onClose: () => void
}

function getPatchCounts(patch: string) {
  let additions = 0
  let deletions = 0

  for (const line of patch.split(/\r?\n/u)) {
    if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("@@")) {
      continue
    }
    if (line.startsWith("+")) {
      additions += 1
      continue
    }
    if (line.startsWith("-")) {
      deletions += 1
    }
  }

  return { additions, deletions }
}

function IconButton(props: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={props.label}
          title={props.label}
          onClick={props.onClick}
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            props.active && "bg-accent text-foreground"
          )}
        >
          {props.children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  )
}

function RightSidebarImpl({
  diffs,
  diffRenderMode,
  wrapLines,
  onOpenFile,
  onDiffRenderModeChange,
  onWrapLinesChange,
  onClose,
}: RightSidebarProps) {
  const [collapsedPaths, setCollapsedPaths] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(diffs.files.map((file) => [file.path, true]))
  )

  useEffect(() => {
    setCollapsedPaths((current) => {
      const next: Record<string, boolean> = {}
      for (const file of diffs.files) {
        next[file.path] = current[file.path] ?? true
      }
      return next
    })
  }, [diffs.files])

  return (
    <div className="h-full min-h-0 border-l border-border bg-background md:min-w-[300px]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="truncate text-xs text-muted-foreground">Diffs</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              label="Unified diff"
              active={diffRenderMode === "unified"}
              onClick={() => onDiffRenderModeChange("unified")}
            >
              <Rows3 className="h-4 w-4" />
            </IconButton>
            <IconButton
              label="Side-by-side diff"
              active={diffRenderMode === "split"}
              onClick={() => onDiffRenderModeChange("split")}
            >
              <Columns2 className="h-4 w-4" />
            </IconButton>
            <IconButton
              label={wrapLines ? "Disable word wrap" : "Enable word wrap"}
              active={wrapLines}
              onClick={() => onWrapLinesChange(!wrapLines)}
            >
              <WrapText className="h-4 w-4" />
            </IconButton>
            <button
              type="button"
              aria-label="Close right sidebar"
              onClick={onClose}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          {diffs.status === "no_repo" ? (
            <div className="flex h-full items-center justify-center px-6 py-3 text-center">
              <p className="text-sm text-muted-foreground">Open a git repo to view current file diffs.</p>
            </div>
          ) : diffs.files.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 py-3 text-center">
              <p className="text-sm text-muted-foreground">No file changes.</p>
            </div>
          ) : (
            <div className="">
              {diffs.files.map((file) => {
                const counts = getPatchCounts(file.patch)
                const isCollapsed = collapsedPaths[file.path] ?? true

                return (
                <div key={file.path} className="border-b border-border/60 border-r border-border/60 ">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setCollapsedPaths((current) => ({ ...current, [file.path]: !isCollapsed }))}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return
                      event.preventDefault()
                      setCollapsedPaths((current) => ({ ...current, [file.path]: !isCollapsed }))
                    }}
                    className={cn(
                      "px-4 sticky top-0 z-10 flex cursor-pointer items-center justify-between gap-3 bg-background py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                      !isCollapsed && "border-b border-border/50"
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 truncate" title={file.path}>{file.path}</span>
                      <button
                        type="button"
                        aria-label={`Open ${file.path} in editor`}
                        title={`Open ${file.path} in editor`}
                        onClick={(event) => {
                          event.stopPropagation()
                          onOpenFile(file.path)
                        }}
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm opacity-70 transition-colors hover:opacity-100"
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </button>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="whitespace-nowrap font-mono">
                        {counts.additions > 0 ? <span className="text-green-600 dark:text-green-400">+{counts.additions}</span> : null}
                        {counts.deletions > 0 ? (
                          <span className={counts.additions > 0 ? "ml-2 text-red-600 dark:text-red-400" : "text-red-600 dark:text-red-400"}>
                            -{counts.deletions}
                          </span>
                        ) : null}
                      </span>
                      {isCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                    </div>
                  </div>
                  {!isCollapsed ? (
                    <div className="kanna-diff-patch pb-[1px]">
                      <PatchDiff
                        patch={file.patch}
                        options={{
                          diffStyle: diffRenderMode,
                          disableFileHeader: true,
                          overflow: wrapLines ? "wrap" : "scroll",
                          lineDiffType: "word",
                          diffIndicators: "classic",
                        }}
                      />
                    </div>
                  ) : null}
                </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export const RightSidebar = memo(RightSidebarImpl)
