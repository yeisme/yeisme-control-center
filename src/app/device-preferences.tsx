import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { defaultDevicePreferences, loadDevicePreferences, saveDevicePreferences, type DevicePreferences, type MotionPreference } from "../shared/preferences";

interface DevicePreferencesValue { motion: MotionPreference; setMotion: (motion: MotionPreference) => void; reset: () => void }

const DevicePreferencesContext = createContext<DevicePreferencesValue>({ motion: "system", setMotion: () => undefined, reset: () => undefined });

function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

/** `html[data-motion]` says what this device chose; without it the system's preference applies. `theme-boot` sets it first. */
export function applyMotion(motion: MotionPreference, root: HTMLElement = document.documentElement) {
  if (motion === "system") delete root.dataset.motion;
  else root.dataset.motion = motion;
}

/** Choices that belong to this device rather than to an account: how much things move (the theme lives in `theme`). */
export function DevicePreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<DevicePreferences>(() => { const store = storage(); return store ? loadDevicePreferences(store) : defaultDevicePreferences; });
  useEffect(() => applyMotion(prefs.motion), [prefs.motion]);
  const write = useCallback((next: DevicePreferences) => {
    const store = storage();
    if (store) saveDevicePreferences(store, next);
    setPrefs(next);
  }, []);
  const setMotion = useCallback((motion: MotionPreference) => write({ ...prefs, motion }), [prefs, write]);
  const reset = useCallback(() => write(defaultDevicePreferences), [write]);
  const value = useMemo(() => ({ motion: prefs.motion, setMotion, reset }), [prefs.motion, setMotion, reset]);
  return <DevicePreferencesContext.Provider value={value}>{children}</DevicePreferencesContext.Provider>;
}

export const useDevicePreferences = () => useContext(DevicePreferencesContext);
