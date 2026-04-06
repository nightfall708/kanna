import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { ChatDiffFile, ChatDiffSnapshot } from "../shared/types"

interface StoredChatDiffState {
  status: ChatDiffSnapshot["status"]
  files: ChatDiffFile[]
}

function createEmptyState(): StoredChatDiffState {
  return {
    status: "unknown",
    files: [],
  }
}

function snapshotsEqual(left: StoredChatDiffState | undefined, right: StoredChatDiffState) {
  if (!left) {
    return right.status === "unknown" && right.files.length === 0
  }
  if (left.status !== right.status) return false
  if (left.files.length !== right.files.length) return false
  return left.files.every((file, index) => {
    const other = right.files[index]
    return Boolean(other)
      && file.path === other.path
      && file.changeType === other.changeType
      && file.patch === other.patch
  })
}

async function fileExists(filePath: string) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function runGit(args: string[], cwd: string) {
  const process = Bun.spawn(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])

  return {
    stdout,
    stderr,
    exitCode,
  }
}

async function resolveRepo(projectPath: string): Promise<{ repoRoot: string; baseCommit: string | null } | null> {
  const topLevel = await runGit(["rev-parse", "--show-toplevel"], projectPath)
  if (topLevel.exitCode !== 0) {
    return null
  }

  const repoRoot = topLevel.stdout.trim()
  const head = await runGit(["rev-parse", "--verify", "HEAD"], repoRoot)
  return {
    repoRoot,
    baseCommit: head.exitCode === 0 ? head.stdout.trim() : null,
  }
}

function parseStatusPaths(output: string) {
  const paths = new Set<string>()

  for (const rawLine of output.split(/\r?\n/u)) {
    const line = rawLine.trimEnd()
    if (line.length < 4) continue
    const value = line.slice(3)
    if (!value) continue
    if (value.includes(" -> ")) {
      const [fromPath, toPath] = value.split(" -> ")
      if (fromPath) paths.add(fromPath)
      if (toPath) paths.add(toPath)
      continue
    }
    paths.add(value)
  }

  return [...paths].sort((left, right) => left.localeCompare(right))
}

async function listDirtyPaths(repoRoot: string) {
  const status = await runGit(["status", "--short", "--untracked-files=all"], repoRoot)
  if (status.exitCode !== 0) {
    throw new Error(status.stderr.trim() || "Failed to read git status")
  }

  const paths = parseStatusPaths(status.stdout)
  return paths
}

async function readWorktreeFile(repoRoot: string, relativePath: string): Promise<string | null> {
  const absolutePath = path.join(repoRoot, relativePath)
  if (!(await fileExists(absolutePath))) {
    return null
  }

  return await readFile(absolutePath, "utf8")
}

async function readBaseFile(repoRoot: string, baseCommit: string | null, relativePath: string): Promise<string | null> {
  if (!baseCommit) {
    return null
  }

  const result = await runGit(["show", `${baseCommit}:${relativePath}`], repoRoot)
  if (result.exitCode !== 0) {
    return null
  }
  return result.stdout
}

async function createPatch(relativePath: string, beforeText: string | null, afterText: string | null) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "kanna-diff-"))
  const beforePath = path.join(tempDir, "before")
  const afterPath = path.join(tempDir, "after")

  try {
    await writeFile(beforePath, beforeText ?? "", "utf8")
    await writeFile(afterPath, afterText ?? "", "utf8")

    const result = await runGit(
      [
        "diff",
        "--no-index",
        "--no-ext-diff",
        "--text",
        "--unified=3",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "before",
        "after",
      ],
      tempDir
    )

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(result.stderr.trim() || `Failed to build patch for ${relativePath}`)
    }

    return result.stdout
      .replace("diff --git a/before b/after", `diff --git a/${relativePath} b/${relativePath}`)
      .replace("--- a/before", `--- a/${relativePath}`)
      .replace("+++ b/after", `+++ b/${relativePath}`)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function computeCurrentFiles(repoRoot: string, baseCommit: string | null): Promise<ChatDiffFile[]> {
  const currentDirtyPaths = await listDirtyPaths(repoRoot)
  const files: ChatDiffFile[] = []

  for (const relativePath of currentDirtyPaths) {
    const beforeText = await readBaseFile(repoRoot, baseCommit, relativePath)
    const afterText = await readWorktreeFile(repoRoot, relativePath)

    if (beforeText === afterText) {
      continue
    }

    const patch = await createPatch(relativePath, beforeText, afterText)
    files.push({
      path: relativePath,
      changeType: beforeText === null ? "added" : afterText === null ? "deleted" : "modified",
      patch,
    })
  }

  return files
}

export class DiffStore {
  private readonly states = new Map<string, StoredChatDiffState>()

  constructor(_: string) {}

  async initialize() {}

  getSnapshot(chatId: string): ChatDiffSnapshot {
    const state = this.states.get(chatId) ?? createEmptyState()
    return {
      status: state.status,
      files: [...state.files],
    }
  }

  async refreshSnapshot(chatId: string, projectPath: string) {
    const repo = await resolveRepo(projectPath)
    if (!repo) {
      const nextState = {
        status: "no_repo",
        files: [],
      } satisfies StoredChatDiffState
      const changed = !snapshotsEqual(this.states.get(chatId), nextState)
      this.states.set(chatId, nextState)
      return changed
    }

    const files = await computeCurrentFiles(repo.repoRoot, repo.baseCommit)
    const nextState = {
      status: "ready",
      files,
    } satisfies StoredChatDiffState
    const changed = !snapshotsEqual(this.states.get(chatId), nextState)
    this.states.set(chatId, nextState)
    return changed
  }
}
