import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { App } from "./client/app/App"
import { ThemeProvider } from "./client/hooks/useTheme"
import { normalizeBasePath } from "./shared/branding"
import "@xterm/xterm/css/xterm.css"
import "./index.css"

const container = document.getElementById("root")

if (!container) {
  throw new Error("Missing #root")
}

const basePath = normalizeBasePath(import.meta.env.BASE_URL)

createRoot(container).render(
  <StrictMode>
    <BrowserRouter basename={basePath === "/" ? undefined : basePath}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
)
