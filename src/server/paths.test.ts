import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { listDirectory } from "./paths"

let root: string

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "kanna-fs-list-"))
  await mkdir(path.join(root, "beta"))
  await mkdir(path.join(root, "Alpha"))
  await mkdir(path.join(root, ".git"))
  await mkdir(path.join(root, ".hidden-dir"))
  await writeFile(path.join(root, "zeta.txt"), "")
  await writeFile(path.join(root, "README.md"), "")
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("listDirectory", () => {
  test("lists directories first, each group sorted case-insensitively", async () => {
    const result = await listDirectory(root)
    expect(result.entries.map((entry) => entry.name)).toEqual([
      ".git",
      ".hidden-dir",
      "Alpha",
      "beta",
      "README.md",
      "zeta.txt",
    ])
    expect(result.entries.map((entry) => entry.kind)).toEqual([
      "dir", "dir", "dir", "dir", "file", "file",
    ])
  })

  test("reports git repos, resolved path, and parent path", async () => {
    const result = await listDirectory(root)
    expect(result.isGitRepo).toBe(true)
    expect(result.path).toBe(root)
    expect(result.parentPath).toBe(path.dirname(root))
    expect(result.truncated).toBe(false)

    const child = await listDirectory(path.join(root, "Alpha"))
    expect(child.isGitRepo).toBe(false)
    expect(child.entries).toEqual([])
    expect(child.parentPath).toBe(root)
  })

  test("defaults to the home directory and reports null parent at the root", async () => {
    const home = await listDirectory()
    expect(home.path).toBe(homedir())
    expect(home.homePath).toBe(homedir())

    const fsRoot = await listDirectory("/")
    expect(fsRoot.parentPath).toBeNull()
  })

  test("expands ~ paths", async () => {
    const result = await listDirectory("~")
    expect(result.path).toBe(homedir())
  })

  test("throws a friendly error for missing folders", async () => {
    expect(listDirectory(path.join(root, "does-not-exist"))).rejects.toThrow(/Folder not found/)
  })

  test("throws a friendly error when the path is a file", async () => {
    expect(listDirectory(path.join(root, "zeta.txt"))).rejects.toThrow(/Not a folder/)
  })
})
