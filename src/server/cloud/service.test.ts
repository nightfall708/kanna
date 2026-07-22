import { describe, expect, test } from "bun:test"
import {
  buildLaunchAgentPlist,
  buildServicePath,
  buildSystemdUnit,
  installService,
  resolveServiceProgramArguments,
  runServiceCommand,
  serviceStatus,
  uninstallService,
  type ExecResult,
  type ServiceDeps,
} from "./service"

const HOME = "/Users/jake"

function fakeExec(handler?: (command: string, args: string[]) => ExecResult) {
  const calls: Array<{ command: string; args: string[] }> = []
  const execImpl = (command: string, args: string[]): ExecResult => {
    calls.push({ command, args })
    return handler?.(command, args) ?? { code: 0, stdout: "", stderr: "" }
  }
  return { execImpl, calls }
}

function fakeFs() {
  const written: Array<{ path: string; content: string }> = []
  const mkdirs: string[] = []
  const unlinked: string[] = []
  return {
    written,
    mkdirs,
    unlinked,
    writeFileImpl: async (filePath: string, content: string) => {
      written.push({ path: filePath, content })
    },
    mkdirImpl: async (dirPath: string) => {
      mkdirs.push(dirPath)
    },
    unlinkImpl: async (filePath: string) => {
      unlinked.push(filePath)
    },
  }
}

function darwinDeps(overrides: Partial<ServiceDeps> = {}): ServiceDeps {
  const { execImpl } = fakeExec()
  return {
    platform: "darwin",
    home: HOME,
    uid: 501,
    env: {},
    execImpl,
    existsSyncImpl: () => true,
    whichImpl: () => "/Users/jake/.bun/bin/kanna",
    bunPath: "/Users/jake/.bun/bin/bun",
    ...overrides,
  }
}

describe("buildServicePath", () => {
  test("darwin: probed user dirs first, then stable system dirs", () => {
    const existing = new Set([
      `${HOME}/.bun/bin`,
      `${HOME}/.local/bin`,
      "/opt/homebrew/bin",
    ])
    const result = buildServicePath({
      platform: "darwin",
      home: HOME,
      env: {},
      existsSyncImpl: (candidate) => existing.has(candidate),
    })
    expect(result).toBe(
      [
        `${HOME}/.bun/bin`,
        `${HOME}/.local/bin`,
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
      ].join(":"),
    )
  })

  test("extraDirs (interactive-shell tool locations) come first and are probed", () => {
    const existing = new Set([
      `${HOME}/.nvm/versions/node/v22.20.0/bin`,
      `${HOME}/.bun/bin`,
    ])
    const result = buildServicePath({
      platform: "darwin",
      home: HOME,
      env: {},
      existsSyncImpl: (candidate) => existing.has(candidate),
      extraDirs: [`${HOME}/.nvm/versions/node/v22.20.0/bin`, "/does/not/exist"],
    })
    expect(result.startsWith(`${HOME}/.nvm/versions/node/v22.20.0/bin:`)).toBe(true)
    expect(result).not.toContain("/does/not/exist")
  })

  test("missing dirs are excluded; BUN_INSTALL is honored; no duplicates", () => {
    const existing = new Set(["/custom/bun/bin"])
    const result = buildServicePath({
      platform: "linux",
      home: HOME,
      env: { BUN_INSTALL: "/custom/bun" },
      existsSyncImpl: (candidate) => existing.has(candidate),
    })
    expect(result.startsWith("/custom/bun/bin:")).toBe(true)
    expect(result).not.toContain(".nvm")
    expect(result.split(":").length).toBe(new Set(result.split(":")).size)
  })
})

describe("resolveServiceProgramArguments", () => {
  test("uses the global kanna shim with the current bun", () => {
    const result = resolveServiceProgramArguments(darwinDeps())
    expect(result).toEqual({
      ok: true,
      programArguments: ["/Users/jake/.bun/bin/bun", "/Users/jake/.bun/bin/kanna", "--no-open"],
    })
  })

  test("installs kanna globally when the shim is missing", () => {
    const { execImpl, calls } = fakeExec()
    let installed = false
    const result = resolveServiceProgramArguments(
      darwinDeps({
        execImpl: (command, args) => {
          const r = execImpl(command, args)
          installed = true
          return r
        },
        whichImpl: () => (installed ? "/Users/jake/.bun/bin/kanna" : null),
      }),
    )
    expect(result.ok).toBe(true)
    expect(calls[0]).toEqual({
      command: "/Users/jake/.bun/bin/bun",
      args: ["install", "-g", "kanna-code"],
    })
  })

  test("KANNA_SERVICE_EXEC overrides resolution (repo dev / self-host)", () => {
    const result = resolveServiceProgramArguments(
      darwinDeps({ env: { KANNA_SERVICE_EXEC: "/repo/bin/kanna" }, whichImpl: () => null }),
    )
    expect(result).toEqual({
      ok: true,
      programArguments: ["/Users/jake/.bun/bin/bun", "/repo/bin/kanna", "--no-open"],
    })
  })
})

describe("unit rendering", () => {
  test("plist: KeepAlive only on failure, hardened flags, env PATH/HOME", () => {
    const plist = buildLaunchAgentPlist({
      programArguments: ["/bun", "/kanna", "--no-open"],
      servicePath: "/a:/b",
      home: HOME,
      stdoutPath: `${HOME}/.kanna/logs/service.log`,
      stderrPath: `${HOME}/.kanna/logs/service.err.log`,
    })
    // Clean exits (e.g. single-instance guard) must not crash-loop.
    expect(plist).toContain("<key>SuccessfulExit</key>")
    expect(plist).toContain("<key>ThrottleInterval</key>")
    expect(plist).toContain("<string>sh.kanna</string>")
    expect(plist).toContain("<string>/a:/b</string>")
    expect(plist).toContain(`<string>${HOME}</string>`)
    expect(plist).toContain("<string>--no-open</string>")
  })

  test("systemd unit: on-failure restart + env", () => {
    const unit = buildSystemdUnit({
      programArguments: ["/bun", "/kanna", "--no-open"],
      servicePath: "/a:/b",
      home: HOME,
    })
    expect(unit).toContain('ExecStart="/bun" "/kanna" "--no-open"')
    expect(unit).toContain("Restart=on-failure")
    expect(unit).toContain("Environment=PATH=/a:/b")
    expect(unit).toContain("WantedBy=default.target")
  })
})

describe("installService (darwin)", () => {
  test("nvm-installed agent CLIs land on the service PATH via install-time probing", async () => {
    const fs = fakeFs()
    const { execImpl } = fakeExec()
    const nvmBin = `${HOME}/.nvm/versions/node/v22.20.0/bin`
    const result = await installService(
      darwinDeps({
        execImpl,
        ...fs,
        existsSyncImpl: (candidate) => candidate === nvmBin || candidate === `${HOME}/.bun/bin`,
        whichImpl: (command) => {
          if (command === "kanna") return `${HOME}/.bun/bin/kanna`
          if (command === "claude" || command === "codex" || command === "node") return `${nvmBin}/${command}`
          return null
        },
      }),
    )

    expect(result.ok).toBe(true)
    const plist = fs.written[0].content
    const pathValue = plist.match(/<key>PATH<\/key>\s*<string>([^<]*)<\/string>/)?.[1] ?? ""
    expect(pathValue.startsWith(`${nvmBin}:`)).toBe(true)
    expect(pathValue).toContain(`${HOME}/.bun/bin`)
  })

  test("writes the plist and bootstraps via launchctl", async () => {
    const fs = fakeFs()
    const { execImpl, calls } = fakeExec()
    const result = await installService(darwinDeps({ execImpl, ...fs }))

    expect(result.ok).toBe(true)
    expect(fs.written[0].path).toBe(`${HOME}/Library/LaunchAgents/sh.kanna.plist`)
    expect(fs.written[0].content).toContain("sh.kanna")
    expect(calls.map((call) => `${call.command} ${call.args[0]}`)).toEqual([
      "launchctl bootout",
      "launchctl bootstrap",
      "launchctl kickstart",
    ])
    expect(calls[1].args).toEqual(["bootstrap", "gui/501", `${HOME}/Library/LaunchAgents/sh.kanna.plist`])
  })

  test("bootstrap failure surfaces as a failed result", async () => {
    const fs = fakeFs()
    const { execImpl } = fakeExec((command, args) =>
      args[0] === "bootstrap" ? { code: 5, stdout: "", stderr: "Input/output error" } : { code: 0, stdout: "", stderr: "" },
    )
    const result = await installService(darwinDeps({ execImpl, ...fs }))
    expect(result.ok).toBe(false)
    expect(result.message).toContain("bootstrap failed")
  })
})

describe("installService (linux)", () => {
  test("writes the unit, reloads, enables, attempts linger", async () => {
    const fs = fakeFs()
    const { execImpl, calls } = fakeExec()
    const result = await installService({
      platform: "linux",
      home: HOME,
      env: { USER: "jake" },
      execImpl,
      existsSyncImpl: () => true,
      whichImpl: () => "/usr/local/bin/kanna",
      bunPath: "/usr/local/bin/bun",
      ...fs,
    })

    expect(result.ok).toBe(true)
    expect(fs.written[0].path).toBe(`${HOME}/.config/systemd/user/kanna.service`)
    expect(calls.map((call) => call.args.join(" "))).toEqual([
      "--user daemon-reload",
      "--user enable --now kanna",
      "enable-linger jake",
    ])
  })
})

describe("uninstall / status / command", () => {
  test("uninstall boots out and removes the plist", async () => {
    const fs = fakeFs()
    const { execImpl, calls } = fakeExec()
    const result = await uninstallService(darwinDeps({ execImpl, ...fs }))
    expect(result.ok).toBe(true)
    expect(calls[0].args[0]).toBe("bootout")
    expect(fs.unlinked).toEqual([`${HOME}/Library/LaunchAgents/sh.kanna.plist`])
  })

  test("status distinguishes not-installed / loaded / stale", async () => {
    const notInstalled = await serviceStatus(darwinDeps({ existsSyncImpl: () => false }))
    expect(notInstalled.ok).toBe(false)
    expect(notInstalled.message).toContain("not installed")

    const loaded = await serviceStatus(darwinDeps())
    expect(loaded.ok).toBe(true)

    const { execImpl } = fakeExec(() => ({ code: 113, stdout: "", stderr: "" }))
    const stale = await serviceStatus(darwinDeps({ execImpl }))
    expect(stale.ok).toBe(false)
    expect(stale.message).toContain("not loaded")
  })

  test("unsupported platforms fail cleanly everywhere", async () => {
    const deps: ServiceDeps = { platform: "win32" }
    expect((await installService(deps)).ok).toBe(false)
    expect((await uninstallService(deps)).ok).toBe(false)
    expect((await serviceStatus(deps)).ok).toBe(false)
  })

  test("runServiceCommand maps results to exit codes with the log prefix", async () => {
    const logs: string[] = []
    const warns: string[] = []
    const io = {
      log: (m: string) => logs.push(m),
      warn: (m: string) => warns.push(m),
      logPrefix: "[kanna]",
    }
    expect(await runServiceCommand("install", io, darwinDeps({ ...fakeFs() }))).toBe(0)
    expect(logs.some((line) => line.startsWith("[kanna] installed"))).toBe(true)
    expect(await runServiceCommand("status", io, darwinDeps({ existsSyncImpl: () => false }))).toBe(1)
    expect(warns.some((line) => line.includes("not installed"))).toBe(true)
  })
})
