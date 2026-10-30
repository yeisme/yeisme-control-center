import { lazy, useState, type ComponentType } from "react";

/**
 * A route page that renders straight away once its chunk is in memory. A lazy component suspends on its first render
 * even when the chunk was warmed, and React then keeps the skeleton up for at least 300ms before revealing the page:
 * every first visit took ~320ms on the production build, against ~30ms for a repeat visit. Only a page whose chunk is
 * still loading goes through the lazy component and the skeleton.
 */
export function routePage(load: () => Promise<{ default: ComponentType }>) {
  let ready: ComponentType | undefined;
  const preload = () => load().then((module) => { ready = module.default; return module; });
  const Lazy = lazy(preload);
  function Page() {
    // Chosen once per mount: swapping the lazy wrapper for the loaded component later would remount the page.
    const [Loaded] = useState(() => ready);
    return Loaded ? <Loaded /> : <Lazy />;
  }
  return { Page, preload };
}
