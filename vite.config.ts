import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { DEV_CLIENT_PORT, DEV_SERVER_PORT } from "./src/shared/ports"

function normalizeBasePath(basePath?: string) {
  const trimmed = basePath?.trim() ?? ""
  if (!trimmed || trimmed === "/") {
    return "/"
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  return `${withLeadingSlash.replace(/\/+$/, "")}/`
}

export default defineConfig({
  base: normalizeBasePath(process.env.KANNA_BASE_PATH),
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: DEV_CLIENT_PORT,
    strictPort: true,
    proxy: {
      "/ws": {
        target: `ws://localhost:${DEV_SERVER_PORT}`,
        ws: true,
      },
      "/health": {
        target: `http://localhost:${DEV_SERVER_PORT}`,
      },
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
})
