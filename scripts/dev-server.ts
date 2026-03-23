import process from "node:process"
import { CLI_CHILD_MODE, CLI_CHILD_MODE_ENV_VAR } from "../src/server/restart"

process.env.KANNA_RUNTIME_PROFILE = "dev"
process.env.KANNA_DISABLE_SELF_UPDATE = "1"

if (process.env[CLI_CHILD_MODE_ENV_VAR] === CLI_CHILD_MODE) {
  await import("../src/server/cli")
} else {
  await import("../src/server/cli-supervisor")
}
