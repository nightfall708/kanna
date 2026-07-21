import { beforeEach, describe, expect, test } from "bun:test"
import type { CloudMachineSummary } from "../../shared/cloud-api"
import { findCurrentMachine, useConnectionStore } from "./connectionStore"

const MACHINES: CloudMachineSummary[] = [
  {
    subdomain: "jakemor-mbp",
    name: "Jake's MBP",
    appOrigin: "https://jakemor-mbp.kanna.sh",
    online: true,
    lastSeenAt: 1,
  },
  {
    subdomain: "jakemor-studio",
    name: "Studio",
    appOrigin: "https://jakemor-studio.kanna.sh",
    online: false,
    lastSeenAt: null,
  },
]

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  useConnectionStore.setState({ mode: "unknown", machines: [] })
})

describe("connectionStore.load", () => {
  test("JSON 200 from /__cloud/machines → cloud mode with machines", async () => {
    const fetchImpl = (async () => jsonResponse({ machines: MACHINES })) as unknown as typeof fetch
    await useConnectionStore.getState().load(fetchImpl)
    expect(useConnectionStore.getState().mode).toBe("cloud")
    expect(useConnectionStore.getState().machines).toEqual(MACHINES)
  })

  test("machine's explicit 404 → local mode", async () => {
    const fetchImpl = (async () => jsonResponse({ error: "Not found" }, 404)) as unknown as typeof fetch
    await useConnectionStore.getState().load(fetchImpl)
    expect(useConnectionStore.getState().mode).toBe("local")
  })

  test("HTML 200 (stale server SPA fallback) → local mode", async () => {
    const fetchImpl = (async () =>
      new Response("<!doctype html>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch
    await useConnectionStore.getState().load(fetchImpl)
    expect(useConnectionStore.getState().mode).toBe("local")
  })

  test("network failure → local mode", async () => {
    const fetchImpl = (async () => {
      throw new Error("offline")
    }) as unknown as typeof fetch
    await useConnectionStore.getState().load(fetchImpl)
    expect(useConnectionStore.getState().mode).toBe("local")
  })
})

describe("findCurrentMachine", () => {
  test("matches by hostname", () => {
    expect(findCurrentMachine(MACHINES, "jakemor-mbp.kanna.sh")?.subdomain).toBe("jakemor-mbp")
    expect(findCurrentMachine(MACHINES, "JAKEMOR-STUDIO.kanna.sh:443")?.subdomain).toBe("jakemor-studio")
    expect(findCurrentMachine(MACHINES, "localhost:3210")).toBeNull()
  })
})
