"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";

export type RealtimeScope = "directory" | "member" | "admin";
export type RealtimeChange = { scope: RealtimeScope; memberId: string | null };
type RealtimeSignal = RealtimeChange | { revoked: true };
type Listener = (signal: RealtimeSignal) => void;
type Status = "connecting" | "live" | "offline";

/*
 * One shared EventSource per browser tab. The server authorizes every event
 * against the viewer's session; events carry no document content, only a hint
 * that an authorized refetch is needed.
 */
const listeners = new Set<Listener>();
const statusListeners = new Set<() => void>();
let source: EventSource | null = null;
let status: Status = "connecting";
let retryTimer: number | undefined;
let retryDelay = 3000;

function setStatus(next: Status) {
  if (status === next) return;
  status = next;
  for (const listener of statusListeners) listener();
}

function connect() {
  if (source || typeof window === "undefined" || listeners.size === 0) return;
  window.clearTimeout(retryTimer);
  setStatus("connecting");
  const stream = new EventSource("/api/stream");
  source = stream;
  stream.onopen = () => {
    retryDelay = 3000;
    setStatus("live");
  };
  stream.addEventListener("change", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent<string>).data) as RealtimeChange;
      for (const listener of listeners) listener(data);
    } catch {
      /* ignore malformed events */
    }
  });
  stream.addEventListener("revoked", () => {
    for (const listener of listeners) listener({ revoked: true });
  });
  stream.onerror = () => {
    if (stream.readyState === EventSource.CLOSED) {
      stream.close();
      if (source === stream) source = null;
      setStatus("offline");
      retryTimer = window.setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30_000);
    } else {
      setStatus("connecting");
    }
  };
}

function disconnect() {
  source?.close();
  source = null;
  window.clearTimeout(retryTimer);
}

export function useRealtime(listener: Listener) {
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(() => {
    const forward: Listener = (signal) => latest.current(signal);
    listeners.add(forward);
    connect();
    return () => {
      listeners.delete(forward);
      if (listeners.size === 0) disconnect();
    };
  }, []);
}

let refreshTimer: number | undefined;

/** Re-renders the current route's server data when a relevant change happens. */
export function LiveRefresh({ scopes, memberId }: { scopes: RealtimeScope[]; memberId?: string }) {
  const router = useRouter();
  useRealtime((signal) => {
    if ("revoked" in signal) {
      router.refresh();
      return;
    }
    if (!scopes.includes(signal.scope)) return;
    if (signal.scope === "member" && memberId && signal.memberId !== memberId) return;
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => router.refresh(), 250);
  });
  return null;
}

function subscribeStatus(listener: () => void) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function LiveIndicator({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  const current = useSyncExternalStore(
    subscribeStatus,
    () => status,
    () => "connecting" as Status,
  );
  const label = current === "live" ? "Live" : current === "connecting" ? "Connecting" : "Reconnecting";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11.5px] font-medium",
        tone === "dark" ? "text-zinc-400" : "text-zinc-500",
        className,
      )}
      title={current === "live" ? "Updates appear automatically" : "Live updates are reconnecting"}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          current === "live" ? "bg-emerald-500" : current === "connecting" ? "bg-amber-400" : "bg-zinc-400",
        )}
      />
      {label}
    </span>
  );
}
