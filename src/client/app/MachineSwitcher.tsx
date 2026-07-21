import { useEffect, useState } from "react"
import { ExternalLink, Globe, Laptop, MonitorSmartphone } from "lucide-react"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog"
import { InputPopover, PopoverMenuItem } from "../components/chat-ui/ChatPreferenceControls"
import { findCurrentMachine, useConnectionStore } from "../stores/connectionStore"

const MANAGE_MACHINES_URL = "https://kanna.sh/machines"

function OnlineDot({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${online ? "bg-emerald-500" : "bg-slate-400 dark:bg-slate-600"}`}
      aria-hidden
    />
  )
}

function PairInstructionsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Use this machine from anywhere</DialogTitle>
          <DialogDescription>
            Pair it with kanna.sh to get a personal URL that works from any browser.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              Sign in at{" "}
              <a href={MANAGE_MACHINES_URL} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
                kanna.sh/machines
              </a>{" "}
              and add a machine to get a pairing code.
            </li>
            <li>
              Run{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">bunx kanna pair &lt;code&gt;</code>{" "}
              in a terminal on this machine.
            </li>
            <li>
              Restart <code className="rounded bg-muted px-1.5 py-0.5 text-xs">kanna</code> — it comes online automatically from then on.
            </li>
          </ol>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Sidebar machine switcher. Local mode offers pairing instructions; cloud
 * mode lists the account's machines and navigates between their subdomains.
 * Mode comes from connectionStore's /__cloud/machines feature detection.
 */
export function MachineSwitcher() {
  const mode = useConnectionStore((state) => state.mode)
  const machines = useConnectionStore((state) => state.machines)
  const load = useConnectionStore((state) => state.load)
  const [pairDialogOpen, setPairDialogOpen] = useState(false)

  useEffect(() => {
    if (mode === "unknown") {
      void load()
    }
  }, [mode, load])

  if (mode === "unknown") {
    return null
  }

  if (mode === "local") {
    return (
      <>
        <InputPopover
          triggerClassName="w-full justify-between pl-3 pr-[9px] py-1.5 mb-1 rounded-md border border-border"
          trigger={
            <>
              <span className="flex min-w-0 items-center gap-2">
                <Laptop className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate text-xs font-medium">This machine</span>
              </span>
              <span className="text-[10px] uppercase tracking-wide opacity-60">local</span>
            </>
          }
        >
          {(close) => (
            <PopoverMenuItem
              onClick={() => {
                close()
                setPairDialogOpen(true)
              }}
              selected={false}
              icon={<Globe className="h-4 w-4" />}
              label="Pair with kanna.sh…"
              description="Use this machine from any browser"
            />
          )}
        </InputPopover>
        <PairInstructionsDialog open={pairDialogOpen} onOpenChange={setPairDialogOpen} />
      </>
    )
  }

  const currentMachine = findCurrentMachine(machines)

  return (
    <InputPopover
      triggerClassName="w-full justify-between pl-3 pr-[9px] py-1.5 mb-1 rounded-md border border-border"
      trigger={
        <>
          <span className="flex min-w-0 items-center gap-2">
            <OnlineDot online={currentMachine?.online ?? true} />
            <span className="truncate text-xs font-medium">
              {currentMachine?.name ?? window.location.hostname}
            </span>
          </span>
          <MonitorSmartphone className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </>
      }
    >
      {(close) => (
        <>
          {machines.map((machine) => {
            const isCurrent = machine.subdomain === currentMachine?.subdomain
            return (
              <PopoverMenuItem
                key={machine.subdomain}
                onClick={() => {
                  close()
                  if (!isCurrent) {
                    window.location.href = machine.appOrigin
                  }
                }}
                selected={isCurrent}
                icon={<OnlineDot online={machine.online} />}
                label={machine.name}
                description={`${machine.subdomain}.kanna.sh${machine.online ? "" : " · offline"}`}
              />
            )
          })}
          <PopoverMenuItem
            onClick={() => {
              close()
              window.open(MANAGE_MACHINES_URL, "_blank", "noopener")
            }}
            selected={false}
            icon={<ExternalLink className="h-4 w-4" />}
            label="Manage machines"
            description="Add or remove machines on kanna.sh"
          />
        </>
      )}
    </InputPopover>
  )
}
