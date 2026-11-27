"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_PREFERENCES,
  preferenceAttributes,
  PREFERENCES_COOKIE,
  serializePreferences,
  type Preferences,
} from "@/lib/preferences";
import { PreferencesDialog } from "./preferences-dialog";

type PreferencesContextValue = {
  preferences: Preferences;
  update: (change: Partial<Preferences>) => void;
  reset: () => void;
  openPanel: () => void;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences must be used inside PreferencesProvider");
  return value;
}

/**
 * Holds this device's display and accessibility choices: applies each change
 * to the page at once (data-* on <html>), remembers it for a year (a cookie the
 * server reads, so the next page opens the same way), and hosts the panel and
 * the reading guide.
 */
export function PreferencesProvider({ initial, children }: { initial: Preferences; children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(initial);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(preferenceAttributes(preferences))) root.setAttribute(name, value);
    document.cookie = `${PREFERENCES_COOKIE}=${serializePreferences(preferences)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }, [preferences]);

  const update = useCallback((change: Partial<Preferences>) => setPreferences((current) => ({ ...current, ...change })), []);
  const reset = useCallback(() => setPreferences({ ...DEFAULT_PREFERENCES }), []);
  const openPanel = useCallback(() => setPanelOpen(true), []);
  const value = useMemo(() => ({ preferences, update, reset, openPanel }), [preferences, update, reset, openPanel]);

  return (
    <PreferencesContext.Provider value={value}>
      {children}
      <PreferencesDialog open={panelOpen} onClose={() => setPanelOpen(false)} />
      {preferences.guide === "on" && <ReadingGuide />}
    </PreferencesContext.Provider>
  );
}

/**
 * A soft band that follows the pointer (or the focused field) across the page,
 * to keep your place in long text. It never blocks clicks.
 */
function ReadingGuide() {
  const band = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const place = (y: number) => {
      if (band.current) band.current.style.transform = `translateY(${Math.round(y - 22)}px)`;
    };
    const onPointer = (event: PointerEvent) => place(event.clientY);
    const onFocus = (event: FocusEvent) => {
      const rect = (event.target as HTMLElement | null)?.getBoundingClientRect?.();
      if (rect) place(rect.top + rect.height / 2);
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("focusin", onFocus);
    place(window.innerHeight / 3);
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("focusin", onFocus);
    };
  }, []);
  return (
    <div
      ref={band}
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-11 border-y border-brand-500/40 bg-brand-500/10 print:hidden"
    />
  );
}
