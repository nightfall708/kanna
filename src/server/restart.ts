export const CLI_CHILD_MODE_ENV_VAR = "KANNA_CLI_MODE"
export const CLI_CHILD_MODE = "child"
export const CLI_RESTART_EXIT_CODE = 75
export const CLI_CHILD_COMMAND_ENV_VAR = "KANNA_CLI_CHILD_COMMAND"
export const CLI_CHILD_ARGS_ENV_VAR = "KANNA_CLI_CHILD_ARGS"

export function shouldRestartCliProcess(code: number | null, signal: NodeJS.Signals | null) {
  return signal === null && code === CLI_RESTART_EXIT_CODE
}

export function parseChildArgsEnv(value: string | undefined) {
  if (!value) return []

  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
      throw new Error("child args must be an array of strings")
    }
    return parsed
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid ${CLI_CHILD_ARGS_ENV_VAR}: ${message}`)
  }
}
