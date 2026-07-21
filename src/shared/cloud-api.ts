/**
 * Kanna Cloud pairing contract.
 *
 * This file is the wire contract between the open-source machine side (this
 * repo) and the hosted control plane / proxy (kanna-site, private). It is
 * mirrored verbatim as `kanna-site/src/shared/cloud-api.ts`.
 *
 * APPEND-ONLY: never remove or rename a field or constant; add optional
 * fields only. Machines in the wild update on their own schedule and must
 * keep working against the deployed control plane (and vice versa).
 *
 * No Bun/node imports here — shared code is imported by both the server and
 * the browser client (and by the kanna-site Worker via the mirror).
 */

/** Default control-plane base URL (the hosted kanna.sh API). */
export const DEFAULT_CLOUD_CONTROL_URL = "https://kanna.sh/api/cloud"

/** Env var that overrides the control-plane base URL (self-hosters, tests). */
export const CLOUD_CONTROL_URL_ENV_VAR = "KANNA_CLOUD_CONTROL_URL"

/**
 * Header the proxy injects on every request it forwards to the machine's
 * tunnel. Value is the machine's `proxySecret`. The proxy strips any inbound
 * copy so the machine can trust it: a request carrying the correct value is
 * guaranteed to have come through the gated proxy.
 */
export const PROXY_AUTH_HEADER = "x-kanna-proxy-auth"

/**
 * Reserved path prefix answered by the proxy itself on machine subdomains —
 * requests under it are never forwarded to the machine. The machine server
 * explicitly 404s this prefix so the client can feature-detect cloud mode
 * (the SPA fallback would otherwise answer with index.html).
 */
export const CLOUD_BROWSER_PATH_PREFIX = "/__cloud"

/**
 * Machine-served endpoint the client fetches before every WebSocket connect.
 * Always present: proxied requests get the direct tunnel URL + a short-lived
 * connect token; local requests get `wsUrl: null` (use same-origin `/ws`).
 */
export const CLOUD_WS_ENDPOINT_PATH = "/api/cloud/ws-endpoint"

// ---------------------------------------------------------------------------
// Machine → control plane (`{controlUrl}/…`)
// ---------------------------------------------------------------------------

/** `POST {controlUrl}/pair` — one-time exchange of a pairing code. */
export interface CloudPairRequest {
  pairingCode: string
  /** Machine display name, used to label the machine in the dashboard. */
  machineName?: string
}

/**
 * Pairing codes are single-use with a short TTL; the control plane responds
 * 404/410 for unknown/expired codes.
 */
export interface CloudPairResponse {
  /** Durable bearer credential for `{controlUrl}/tunnel` + `/machine`. */
  machineToken: string
  /** Shared secret the proxy sends in PROXY_AUTH_HEADER on forwarded requests. */
  proxySecret: string
  /** The claimed subdomain, e.g. "jakemor-mbp". */
  subdomain: string
  /** Public app origin for this machine, e.g. "https://jakemor-mbp.kanna.sh". */
  appOrigin: string
}

/**
 * `POST {controlUrl}/tunnel` with `Authorization: Bearer <machineToken>` —
 * sent whenever the tunnel URL changes and periodically as a heartbeat
 * (~2 min) so the control plane can tell online from dead. 401 = revoked.
 */
export interface CloudTunnelUpdateRequest {
  /** Current public tunnel URL, e.g. "https://xyz.trycloudflare.com". */
  url: string
  /** Transport kind — escape hatch for future transports. "cloudflared-quick" today. */
  kind: string
}

export interface CloudTunnelUpdateResponse {
  ok: true
}

/** `DELETE {controlUrl}/machine` with bearer token — unlink this machine. */
export interface CloudMachineRemoveResponse {
  ok: true
}

/**
 * `POST {controlUrl}/offline` with bearer token — best-effort graceful
 * shutdown signal: clears the registered tunnel so the dashboard and proxy
 * show offline immediately instead of waiting out the heartbeat window.
 * (Added after v1; older machines simply never call it.)
 */
export interface CloudMarkOfflineResponse {
  ok: true
}

// ---------------------------------------------------------------------------
// Machine-served (consumed by the client bundle the machine serves)
// ---------------------------------------------------------------------------

/** `GET /api/cloud/ws-endpoint` response. */
export interface CloudWsEndpointResponse {
  /**
   * Direct WebSocket URL (`wss://<tunnel-host>/ws`) when the request arrived
   * through the proxy; null for local requests (client connects same-origin).
   */
  wsUrl: string | null
  /** Short-lived token to append as `?token=`; present when wsUrl is set. */
  connectToken?: string
  expiresInMs?: number
}

// ---------------------------------------------------------------------------
// Proxy-answered browser API (implemented by kanna-site, typed here so the
// OSS client can consume it; never reaches the machine)
// ---------------------------------------------------------------------------

export interface CloudMachineSummary {
  subdomain: string
  name: string
  /** e.g. "https://jakemor-mbp.kanna.sh" */
  appOrigin: string
  online: boolean
  /** Unix ms of the last tunnel heartbeat, null if never seen. */
  lastSeenAt: number | null
}

/** `GET /__cloud/machines` — the signed-in account's machines. */
export interface CloudMachinesResponse {
  machines: CloudMachineSummary[]
}
