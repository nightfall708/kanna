import { describe, expect, test } from "bun:test"
import {
  CLOUD_BROWSER_PATH_PREFIX,
  CLOUD_WS_ENDPOINT_PATH,
  DEFAULT_CLOUD_CONTROL_URL,
  PROXY_AUTH_HEADER,
} from "./cloud-api"

describe("cloud-api contract", () => {
  test("constants are stable (append-only contract)", () => {
    // These values are load-bearing across two independently deployed repos.
    // Changing any of them breaks paired machines in the wild.
    expect(DEFAULT_CLOUD_CONTROL_URL).toBe("https://kanna.sh/api/cloud")
    expect(PROXY_AUTH_HEADER).toBe("x-kanna-proxy-auth")
    expect(CLOUD_BROWSER_PATH_PREFIX).toBe("/__cloud")
    expect(CLOUD_WS_ENDPOINT_PATH).toBe("/api/cloud/ws-endpoint")
  })

  test("proxy auth header is lowercase (Headers.get canonicalizes, D1 mirror compares raw)", () => {
    expect(PROXY_AUTH_HEADER).toBe(PROXY_AUTH_HEADER.toLowerCase())
  })
})
