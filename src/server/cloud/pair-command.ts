/**
 * `kanna pair` subcommand: exchange a kanna.sh pairing code for machine
 * credentials, plus --status/--disable/--enable/--remove management.
 * Everything is DI'd so cli-runtime tests can drive it without network or
 * filesystem access.
 */

import process from "node:process"
import { createInterface } from "node:readline/promises"
import { getCloudFilePathDisplay, LOG_PREFIX } from "../../shared/branding"
import { PROD_SERVER_PORT } from "../../shared/ports"
import { getMachineDisplayName } from "../machine-name"
import { probeExistingInstance, type ExistingInstance } from "../instance"
import { CloudApiError, createCloudApiClient, type CloudApiClient } from "./api-client"
import {
  deleteCloudIdentity,
  readCloudIdentity,
  writeCloudIdentity,
  type CloudIdentity,
} from "./identity"
import { installService, uninstallService, type ServiceActionResult, type ServiceDeps } from "./service"

export type PairAction = "pair" | "status" | "disable" | "enable" | "remove"

export interface PairCommandArgs {
  action: PairAction
  pairingCode: string | null
}

export interface PairCommandDeps {
  log: (message: string) => void
  warn: (message: string) => void
  readIdentity?: (warn?: (message: string) => void) => Promise<CloudIdentity | null>
  writeIdentity?: (identity: CloudIdentity) => Promise<void>
  deleteIdentity?: () => Promise<boolean>
  createApiClient?: (controlUrl?: string) => CloudApiClient
  getMachineName?: () => string
  confirm?: (question: string) => Promise<boolean>
  installServiceImpl?: (deps?: ServiceDeps) => Promise<ServiceActionResult>
  uninstallServiceImpl?: (deps?: ServiceDeps) => Promise<ServiceActionResult>
  probeExistingInstanceImpl?: (port: number) => Promise<ExistingInstance | null>
  openUrl?: (url: string) => void
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
}

const TUNNEL_WAIT_MAX_ATTEMPTS = 45
const TUNNEL_WAIT_INTERVAL_MS = 1_000

/** Poll the machine's public tunnel /health until it serves (or ~45s). */
async function waitForTunnelOnline(
  tunnelHost: string,
  fetchImpl: typeof fetch,
  sleepImpl: (ms: number) => Promise<void>,
): Promise<boolean> {
  for (let attempt = 0; attempt < TUNNEL_WAIT_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(`https://${tunnelHost}/health`, {
        signal: AbortSignal.timeout(3_000),
      })
      if (response.ok) return true
    } catch {
      // not up yet
    }
    await sleepImpl(TUNNEL_WAIT_INTERVAL_MS)
  }
  return false
}

async function promptConfirm(question: string) {
  if (!process.stdin.isTTY) {
    return true
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`${question} [y/N] `)
    return /^y(es)?$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

/** Returns the process exit code. */
export async function runPairCommand(args: PairCommandArgs, deps: PairCommandDeps): Promise<number> {
  const readIdentity = deps.readIdentity ?? ((warn?: (message: string) => void) => readCloudIdentity(undefined, warn))
  const writeIdentity = deps.writeIdentity ?? ((identity: CloudIdentity) => writeCloudIdentity(identity))
  const deleteIdentity = deps.deleteIdentity ?? (() => deleteCloudIdentity())
  const createApiClient = deps.createApiClient ?? ((controlUrl?: string) => createCloudApiClient({ controlUrl }))
  const getMachineName = deps.getMachineName ?? getMachineDisplayName
  const confirm = deps.confirm ?? promptConfirm
  const { log, warn } = deps

  // While pairing, an unreadable/outdated cloud.json is irrelevant — it's
  // about to be replaced, so don't tell the user to "run kanna pair again"
  // mid-pair. For the management actions the warning matters.
  const identity = await readIdentity(
    args.action === "pair" ? () => {} : (message) => warn(`${LOG_PREFIX} ${message}`),
  )

  switch (args.action) {
    case "pair": {
      if (!args.pairingCode) {
        warn(`${LOG_PREFIX} missing pairing code — get one at https://kanna.sh/machines`)
        return 1
      }
      if (identity) {
        warn(`${LOG_PREFIX} this machine is already paired as ${identity.appOrigin} — re-pairing replaces it`)
      }

      const client = createApiClient()
      let response
      try {
        response = await client.pair(args.pairingCode, getMachineName())
      } catch (error) {
        if (error instanceof CloudApiError && (error.status === 404 || error.status === 410)) {
          warn(`${LOG_PREFIX} that pairing code is ${error.status === 410 ? "expired" : "invalid"} — generate a new one at https://kanna.sh/machines`)
          return 1
        }
        warn(`${LOG_PREFIX} pairing failed: ${error instanceof Error ? error.message : String(error)}`)
        return 1
      }

      await writeIdentity({
        controlUrl: client.controlUrl,
        machineToken: response.machineToken,
        proxySecret: response.proxySecret,
        subdomain: response.subdomain,
        appOrigin: response.appOrigin,
        tunnelToken: response.tunnelToken,
        tunnelHost: response.tunnelHost,
        enabled: true,
      })

      log(`${LOG_PREFIX} paired! this machine is now ${response.appOrigin}`)
      log(`${LOG_PREFIX} credentials saved to ${getCloudFilePathDisplay()}`)

      // If a kanna started before pairing is still running, it holds the
      // port but knows nothing about the new credentials. Install the
      // service anyway (it takes over when that instance exits or at next
      // login — clean exits don't crash-loop), but don't wait for a tunnel
      // that can't come up yet.
      const probe = deps.probeExistingInstanceImpl ?? probeExistingInstance
      const runningBeforePair = await probe(PROD_SERVER_PORT)

      const install = deps.installServiceImpl ?? installService
      const serviceResult = await install({ log: (message) => log(`${LOG_PREFIX} ${message}`) })
      if (!serviceResult.ok) {
        warn(`${LOG_PREFIX} could not set up the background service: ${serviceResult.message}`)
        log(`${LOG_PREFIX} run \`kanna\` to bring this machine online`)
        return 0
      }
      log(`${LOG_PREFIX} ${serviceResult.message}`)

      if (runningBeforePair) {
        warn(`${LOG_PREFIX} a kanna started before pairing is still running at ${runningBeforePair.localUrl} — restart it to bring this machine online`)
        return 0
      }

      log(`${LOG_PREFIX} waiting for the machine to come online…`)
      const online = await waitForTunnelOnline(
        response.tunnelHost,
        deps.fetchImpl ?? fetch,
        deps.sleepImpl ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      )
      if (online) {
        log(`${LOG_PREFIX} online! opening ${response.appOrigin}`)
        deps.openUrl?.(response.appOrigin)
      } else {
        warn(`${LOG_PREFIX} still starting — it will appear at ${response.appOrigin} shortly (logs: ~/.kanna/logs/service.log)`)
      }
      return 0
    }

    case "status": {
      if (!identity) {
        log(`${LOG_PREFIX} not paired — get a pairing code at https://kanna.sh/machines`)
        return 0
      }
      log(`${LOG_PREFIX} paired as ${identity.appOrigin}${identity.enabled ? "" : " (disabled)"}`)
      log(`${LOG_PREFIX} control plane: ${identity.controlUrl}`)
      log(`${LOG_PREFIX} cloud ${identity.enabled ? "starts with every `kanna` run (disable with `kanna pair --disable`)" : "is disabled (enable with `kanna pair --enable`)"}`)
      return 0
    }

    case "disable":
    case "enable": {
      if (!identity) {
        warn(`${LOG_PREFIX} not paired — nothing to ${args.action}`)
        return 1
      }
      const enabled = args.action === "enable"
      await writeIdentity({ ...identity, enabled })
      log(`${LOG_PREFIX} cloud ${enabled ? "enabled — run `kanna` to bring this machine online" : "disabled — `kanna` stays local-only"}`)
      return 0
    }

    case "remove": {
      if (!identity) {
        warn(`${LOG_PREFIX} not paired — nothing to remove`)
        return 1
      }
      const confirmed = await confirm(`Remove this machine (${identity.appOrigin}) from kanna.sh?`)
      if (!confirmed) {
        log(`${LOG_PREFIX} cancelled`)
        return 0
      }

      try {
        await createApiClient(identity.controlUrl).removeMachine(identity.machineToken)
      } catch (error) {
        // Best effort — the machine may already be revoked server-side.
        warn(`${LOG_PREFIX} could not remove the machine on kanna.sh (${error instanceof Error ? error.message : String(error)}); deleting local credentials anyway`)
      }
      await deleteIdentity()
      const uninstall = deps.uninstallServiceImpl ?? uninstallService
      const serviceResult = await uninstall({ log: (message) => log(`${LOG_PREFIX} ${message}`) })
      if (serviceResult.ok) {
        log(`${LOG_PREFIX} background service removed`)
      }
      log(`${LOG_PREFIX} unpaired — local credentials deleted`)
      return 0
    }
  }
}
