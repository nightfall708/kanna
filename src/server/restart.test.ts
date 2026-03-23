import { describe, expect, test } from "bun:test"
import { CLI_CHILD_ARGS_ENV_VAR, CLI_RESTART_EXIT_CODE, parseChildArgsEnv, shouldRestartCliProcess } from "./restart"

describe("shouldRestartCliProcess", () => {
  test("restarts only for the sentinel exit code without a signal", () => {
    expect(shouldRestartCliProcess(CLI_RESTART_EXIT_CODE, null)).toBe(true)
    expect(shouldRestartCliProcess(0, null)).toBe(false)
    expect(shouldRestartCliProcess(1, null)).toBe(false)
    expect(shouldRestartCliProcess(CLI_RESTART_EXIT_CODE, "SIGTERM")).toBe(false)
  })

  test("parses configured child args from the environment", () => {
    expect(parseChildArgsEnv(undefined)).toEqual([])
    expect(parseChildArgsEnv("[\"run\",\"./scripts/dev-server.ts\"]")).toEqual(["run", "./scripts/dev-server.ts"])
    expect(() => parseChildArgsEnv("{\"bad\":true}")).toThrow(`Invalid ${CLI_CHILD_ARGS_ENV_VAR}`)
  })
})
