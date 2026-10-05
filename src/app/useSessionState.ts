"use client";

import { useEffect, useRef, useState } from "react";

export type ThinkLevel = "off" | "low" | "medium" | "high" | "max";

const KEYS = {
  model: "ollama_session_model",
  think: "ollama_session_think",
  collapsed: "ollama_session_collapsed",
  activeId: "ollama_session_active",
} as const;

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // sessionStorage unavailable (privacy mode etc.) — silently degrade
  }
}

// Picky helpers so JSON.parse failures don't trip React
function readJson<T>(key: string): T | null {
  const raw = read(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  write(key, JSON.stringify(value));
}

/**
 * Drop-in replacement for useState that mirrors its value into
 * sessionStorage. `initial` is the default if nothing's stored yet.
 *
 * Setter accepts either a value or an updater function (like React's setState).
 */
export function useSessionState<T>(
  key: string,
  initial: T
): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    const stored = readJson<T>(key);
    return stored === null ? initial : stored;
  });

  // write-through; skip the very first run so we don't clobber a stored value
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    writeJson(key, value);
  }, [key, value]);

  return [value, setValue];
}

// Typed helpers for the specific values we persist, so call sites stay clean.
export const sessionKeys = KEYS;
export const sessionHelpers = { read, write, readJson, writeJson };
