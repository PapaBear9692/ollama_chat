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

function readJson<T>(key: string): T | null {
  const raw = read(key);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed === null ? null : (parsed as T);
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  write(key, JSON.stringify(value));
}

/**
 * Drop-in replacement for useState that mirrors its value into
 * sessionStorage.
 *
 * SSR-safe: the first render always uses `initial` on BOTH server and
 * client (so hydration matches); the stored value is restored in a
 * post-mount effect. Setter accepts a value or an updater function.
 */
export function useSessionState<T>(
  key: string,
  initial: T
): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  const restored = useRef(false);

  useEffect(() => {
    if (!restored.current) {
      // first run (post-mount, client only): pull the stored value
      restored.current = true;
      const stored = readJson<T>(key);
      if (stored !== null && stored !== value) setValue(stored);
      return;
    }
    // subsequent runs: write-through
    writeJson(key, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);

  return [value, setValue];
}

export const sessionKeys = KEYS;
export const sessionHelpers = { read, write, readJson, writeJson };
