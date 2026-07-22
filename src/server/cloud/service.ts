/**
 * Background service management: keeps a paired machine online without a
 * terminal. macOS → per-user LaunchAgent, Linux → systemd user unit (with
 * best-effort linger). Windows unsupported for now.
 *
 * Design notes (borrowed from OpenClaw's battle-tested daemon module):
 * - PATH is CONSTRUCTED from known-good locations probed at install time —
 *   never snapshotted from the interactive shell (version-manager session
 *   paths rot) and never via a login shell (dotfile side effects).
 * - kanna's own runtime is pinned by absolute path (current bun binary +
 *   the global `kanna` shim); PATH exists for the child tools it spawns
 *   (git, claude, codex, …).
 * - launchd KeepAlive is { SuccessfulExit: false }: a clean exit 0 — e.g.
 *   the single-instance guard finding a terminal-run kanna already serving —
 *   must NOT crash-loop; real crashes (non-zero) restart with a 10s throttle.
 *
 * Everything is DI'd (exec, fs, env, platform) for tests.
 */

import { homedir } from "node:os"
import path from "node:path"
import process from "node:process"
import { existsSync } from "node:fs"
import { mkdir, unlink, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { getDataRootDir } from "../../shared/branding"

export const SERVICE_LABEL = "sh.kanna"
export const SYSTEMD_SERVICE_NAME = "kanna"
/** Dev/self-host escape hatch: absolute path to the kanna entry script. */
export const SERVICE_EXEC_ENV_VAR = "KANNA_SERVICE_EXEC"

export type ServicePlatform = "darwin" | "linux" | "unsupported"

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface ServiceDeps {
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  home?: string
  uid?: number
  execImpl?: (command: string, args: string[]) => ExecResult
  existsSyncImpl?: (candidate: string) => boolean
  writeFileImpl?: (filePath: string, content: string) => Promise<void>
  mkdirImpl?: (dirPath: string) => Promise<void>
  unlinkImpl?: (filePath: string) => Promise<void>
  whichImpl?: (command: string) => string | null
  bunPath?: string
  log?: (message: string) => void
}

function defaultExec(command: string, args: string[]): ExecResult {
  const result = spawnSync(command, args, { encoding: "utf8" })
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

function resolvePlatform(platform: NodeJS.Platform): ServicePlatform {
  if (platform === "darwin" || platform === "linux") return platform
  return "unsupported"
}

// ---------------------------------------------------------------------------
// PATH construction (probed, not snapshotted)
// ---------------------------------------------------------------------------

export function buildServicePath(args: {
  platform: NodeJS.Platform
  home: string
  env?: Record<string, string | undefined>
  existsSyncImpl?: (candidate: string) => boolean
}): string {
  const exists = args.existsSyncImpl ?? existsSync
  const env = args.env ?? {}
  const dirs: string[] = []

  const addProbed = (candidate: string | undefined) => {
    if (candidate && path.posix.isAbsolute(candidate) && exists(candidate)) {
      dirs.push(path.posix.normalize(candidate))
    }
  }
  const addAlways = (candidate: string) => {
    dirs.push(candidate)
  }

  // User tool dirs first (bun, agent CLIs, npm globals) — probed so the PATH
  // only contains directories that exist on this machine.
  const bunInstall = env.BUN_INSTALL?.trim()
  addProbed(bunInstall ? `${bunInstall}/bin` : undefined)
  addProbed(`${args.home}/.bun/bin`)
  addProbed(`${args.home}/.local/bin`)
  addProbed(`${args.home}/.npm-global/bin`)
  addProbed(`${args.home}/bin`)

  // Stable system dirs (always included).
  if (args.platform === "darwin") {
    addProbed("/opt/homebrew/bin")
    addProbed("/opt/homebrew/sbin")
    for (const dir of ["/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]) {
      addAlways(dir)
    }
  } else {
    addProbed(`${args.home}/.linuxbrew/bin`)
    addProbed("/home/linuxbrew/.linuxbrew/bin")
    for (const dir of ["/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]) {
      addAlways(dir)
    }
  }

  return [...new Set(dirs)].join(":")
}

// ---------------------------------------------------------------------------
// Command resolution
// ---------------------------------------------------------------------------

function defaultWhich(command: string): string | null {
  return Bun.which(command)
}

/**
 * Resolve the stable command the service runs: [bun, <kanna entry>, --no-open].
 * `bunx` caches are ephemeral, so the entry must be the globally-installed
 * `kanna` shim; installs it when missing. KANNA_SERVICE_EXEC overrides for
 * repo-dev/self-host setups.
 */
export function resolveServiceProgramArguments(deps: ServiceDeps = {}):
  | { ok: true; programArguments: string[] }
  | { ok: false; message: string } {
  const env = deps.env ?? process.env
  const which = deps.whichImpl ?? defaultWhich
  const exec = deps.execImpl ?? defaultExec
  const bunPath = deps.bunPath ?? process.execPath

  const override = env[SERVICE_EXEC_ENV_VAR]?.trim()
  if (override) {
    return { ok: true, programArguments: [bunPath, override, "--no-open"] }
  }

  let kannaPath = which("kanna")
  if (!kannaPath) {
    deps.log?.("installing kanna globally so the service has a stable entrypoint")
    const install = exec(bunPath, ["install", "-g", "kanna-code"])
    if (install.code !== 0) {
      return { ok: false, message: `could not install kanna globally: ${install.stderr.trim() || install.stdout.trim() || `exit ${install.code}`}` }
    }
    kannaPath = which("kanna")
  }
  if (!kannaPath) {
    return { ok: false, message: "could not find the `kanna` command after installing it globally" }
  }

  return { ok: true, programArguments: [bunPath, kannaPath, "--no-open"] }
}

// ---------------------------------------------------------------------------
// Unit file rendering
// ---------------------------------------------------------------------------

function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export function buildLaunchAgentPlist(args: {
  programArguments: string[]
  servicePath: string
  home: string
  stdoutPath: string
  stderrPath: string
}): string {
  const argsXml = args.programArguments
    .map((argument) => `\n      <string>${xmlEscape(argument)}</string>`)
    .join("")
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${SERVICE_LABEL}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
      <key>SuccessfulExit</key>
      <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>ExitTimeOut</key>
    <integer>20</integer>
    <key>ProcessType</key>
    <string>Interactive</string>
    <key>Umask</key>
    <integer>63</integer>
    <key>ProgramArguments</key>
    <array>${argsXml}
    </array>
    <key>WorkingDirectory</key>
    <string>${xmlEscape(args.home)}</string>
    <key>StandardInPath</key>
    <string>/dev/null</string>
    <key>StandardOutPath</key>
    <string>${xmlEscape(args.stdoutPath)}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(args.stderrPath)}</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>${xmlEscape(args.servicePath)}</string>
      <key>HOME</key>
      <string>${xmlEscape(args.home)}</string>
    </dict>
  </dict>
</plist>
`
}

export function buildSystemdUnit(args: {
  programArguments: string[]
  servicePath: string
  home: string
}): string {
  const execStart = args.programArguments.map((argument) => `"${argument.replaceAll('"', '\\"')}"`).join(" ")
  return `[Unit]
Description=Kanna (kanna.sh machine service)
After=network-online.target

[Service]
ExecStart=${execStart}
Restart=on-failure
RestartSec=10
WorkingDirectory=${args.home}
Environment=PATH=${args.servicePath}
Environment=HOME=${args.home}

[Install]
WantedBy=default.target
`
}

// ---------------------------------------------------------------------------
// Install / uninstall / status
// ---------------------------------------------------------------------------

export interface ServiceActionResult {
  ok: boolean
  message: string
}

function resolvePaths(platform: ServicePlatform, home: string) {
  const logsDir = path.join(getDataRootDir(home), "logs")
  if (platform === "darwin") {
    return {
      unitPath: path.join(home, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`),
      logsDir,
      stdoutPath: path.join(logsDir, "service.log"),
      stderrPath: path.join(logsDir, "service.err.log"),
    }
  }
  return {
    unitPath: path.join(home, ".config", "systemd", "user", `${SYSTEMD_SERVICE_NAME}.service`),
    logsDir,
    stdoutPath: path.join(logsDir, "service.log"),
    stderrPath: path.join(logsDir, "service.err.log"),
  }
}

export async function installService(deps: ServiceDeps = {}): Promise<ServiceActionResult> {
  const platform = resolvePlatform(deps.platform ?? process.platform)
  if (platform === "unsupported") {
    return { ok: false, message: "background service is only supported on macOS and Linux for now" }
  }

  const home = deps.home ?? homedir()
  const env = deps.env ?? process.env
  const exec = deps.execImpl ?? defaultExec
  const writeFileImpl = deps.writeFileImpl ?? (async (filePath: string, content: string) => {
    await writeFile(filePath, content, "utf8")
  })
  const mkdirImpl = deps.mkdirImpl ?? (async (dirPath: string) => {
    await mkdir(dirPath, { recursive: true })
  })

  const resolved = resolveServiceProgramArguments(deps)
  if (!resolved.ok) {
    return { ok: false, message: resolved.message }
  }

  const servicePath = buildServicePath({
    platform,
    home,
    env,
    existsSyncImpl: deps.existsSyncImpl,
  })
  const paths = resolvePaths(platform, home)
  await mkdirImpl(paths.logsDir)
  await mkdirImpl(path.dirname(paths.unitPath))

  if (platform === "darwin") {
    const uid = deps.uid ?? process.getuid?.() ?? 501
    await writeFileImpl(
      paths.unitPath,
      buildLaunchAgentPlist({
        programArguments: resolved.programArguments,
        servicePath,
        home,
        stdoutPath: paths.stdoutPath,
        stderrPath: paths.stderrPath,
      }),
    )
    // Re-registering: boot out any previous copy first (ignore failures).
    exec("launchctl", ["bootout", `gui/${uid}/${SERVICE_LABEL}`])
    const bootstrap = exec("launchctl", ["bootstrap", `gui/${uid}`, paths.unitPath])
    if (bootstrap.code !== 0) {
      return { ok: false, message: `launchctl bootstrap failed: ${bootstrap.stderr.trim() || `exit ${bootstrap.code}`}` }
    }
    exec("launchctl", ["kickstart", "-k", `gui/${uid}/${SERVICE_LABEL}`])
    return { ok: true, message: "installed launchd service (starts at login, restarts on crash)" }
  }

  await writeFileImpl(
    paths.unitPath,
    buildSystemdUnit({ programArguments: resolved.programArguments, servicePath, home }),
  )
  const reload = exec("systemctl", ["--user", "daemon-reload"])
  if (reload.code !== 0) {
    return { ok: false, message: `systemctl daemon-reload failed: ${reload.stderr.trim() || `exit ${reload.code}`}` }
  }
  const enable = exec("systemctl", ["--user", "enable", "--now", SYSTEMD_SERVICE_NAME])
  if (enable.code !== 0) {
    return { ok: false, message: `systemctl enable failed: ${enable.stderr.trim() || `exit ${enable.code}`}` }
  }
  // Best-effort: keep the user manager (and kanna) running after logout.
  const user = env.USER ?? env.LOGNAME ?? ""
  if (user) {
    const linger = exec("loginctl", ["enable-linger", user])
    if (linger.code !== 0) {
      deps.log?.("could not enable systemd linger — kanna will stop when you log out (run `sudo loginctl enable-linger $USER` to fix)")
    }
  }
  return { ok: true, message: "installed systemd user service (starts at login, restarts on crash)" }
}

export async function uninstallService(deps: ServiceDeps = {}): Promise<ServiceActionResult> {
  const platform = resolvePlatform(deps.platform ?? process.platform)
  if (platform === "unsupported") {
    return { ok: false, message: "background service is only supported on macOS and Linux for now" }
  }

  const home = deps.home ?? homedir()
  const exec = deps.execImpl ?? defaultExec
  const unlinkImpl = deps.unlinkImpl ?? (async (filePath: string) => {
    await unlink(filePath).catch(() => {})
  })
  const paths = resolvePaths(platform, home)

  if (platform === "darwin") {
    const uid = deps.uid ?? process.getuid?.() ?? 501
    exec("launchctl", ["bootout", `gui/${uid}/${SERVICE_LABEL}`])
  } else {
    exec("systemctl", ["--user", "disable", "--now", SYSTEMD_SERVICE_NAME])
    exec("systemctl", ["--user", "daemon-reload"])
  }
  await unlinkImpl(paths.unitPath)
  return { ok: true, message: "service removed" }
}

export type ServiceAction = "install" | "uninstall" | "status"

/** `kanna service <action>` — returns the process exit code. */
export async function runServiceCommand(
  action: ServiceAction,
  io: { log: (message: string) => void; warn: (message: string) => void; logPrefix: string },
  deps: ServiceDeps = {},
): Promise<number> {
  const serviceDeps: ServiceDeps = { ...deps, log: (message) => io.log(`${io.logPrefix} ${message}`) }
  const result =
    action === "install"
      ? await installService(serviceDeps)
      : action === "uninstall"
        ? await uninstallService(serviceDeps)
        : await serviceStatus(serviceDeps)

  if (result.ok) {
    io.log(`${io.logPrefix} ${result.message}`)
    return 0
  }
  io.warn(`${io.logPrefix} ${result.message}`)
  return 1
}

export async function serviceStatus(deps: ServiceDeps = {}): Promise<ServiceActionResult> {
  const platform = resolvePlatform(deps.platform ?? process.platform)
  if (platform === "unsupported") {
    return { ok: false, message: "background service is only supported on macOS and Linux for now" }
  }

  const home = deps.home ?? homedir()
  const exec = deps.execImpl ?? defaultExec
  const existsImpl = deps.existsSyncImpl ?? existsSync
  const paths = resolvePaths(platform, home)

  if (!existsImpl(paths.unitPath)) {
    return { ok: false, message: "service is not installed" }
  }

  if (platform === "darwin") {
    const uid = deps.uid ?? process.getuid?.() ?? 501
    const result = exec("launchctl", ["print", `gui/${uid}/${SERVICE_LABEL}`])
    return result.code === 0
      ? { ok: true, message: `service installed and loaded (logs: ${paths.stdoutPath})` }
      : { ok: false, message: "service installed but not loaded — run `kanna service install` to repair" }
  }

  const result = exec("systemctl", ["--user", "is-active", SYSTEMD_SERVICE_NAME])
  return result.code === 0
    ? { ok: true, message: `service installed and active (logs: journalctl --user -u ${SYSTEMD_SERVICE_NAME})` }
    : { ok: false, message: "service installed but not active — run `kanna service install` to repair" }
}
