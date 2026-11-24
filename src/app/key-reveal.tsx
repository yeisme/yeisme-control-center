import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { KeyRevealDialog } from "../components/KeyRevealDialog";
import { useWorkspace } from "./workspace";

export interface KeyReveal {
  username: string;
  /** Optional long-lived access key (absent when issuing only a one-time invitation link). */
  key?: string;
  /** Optional one-time invitation token (`yki_live_*`) for `?token=` direct entry. */
  inviteToken?: string;
  inviteExpiresAt?: string;
  title: string;
  after?: string;
  /** Sign out once the person says the key is saved: their own key was reset and they sign in again with it. */
  signOutAfter?: boolean;
}

const KeyRevealContext = createContext<(reveal: KeyReveal) => void>(() => undefined);

/**
 * Holds a new access key above the pages. A page remounts when the session's epoch moves, and every account change moves
 * it, so a key kept in the page could vanish before it was saved. Here it stays until the person closes it, and then it
 * is gone: it is never stored, logged or put in the address.
 */
export function KeyRevealProvider({ children }: { children: ReactNode }) {
  const { logout } = useWorkspace();
  const [reveal, setReveal] = useState<KeyReveal | null>(null);
  const done = useCallback(() => {
    const signOut = reveal?.signOutAfter;
    setReveal(null);
    if (signOut) void logout();
  }, [logout, reveal?.signOutAfter]);
  return <KeyRevealContext.Provider value={setReveal}>
    {children}
    <KeyRevealDialog reveal={reveal} onDone={done} />
  </KeyRevealContext.Provider>;
}

/** Shows a new access key once, over every page. */
export const useKeyReveal = () => useContext(KeyRevealContext);
