/**
 * The boot splash in app/index.html paints before any script. React keeps it up while the session is
 * checked, then fades it out once the first real screen (login, problem or workspace) is ready.
 */
const splashId = "boot-splash";

export function hasBootSplash() {
  return typeof document !== "undefined" && !!document.getElementById(splashId);
}

export function dismissBootSplash() {
  const splash = document.getElementById(splashId);
  if (!splash || splash.dataset.leaving) return;
  splash.dataset.leaving = "true";
  splash.removeAttribute("role");
  const remove = () => splash.remove();
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
    window.setTimeout(remove, 120);
    return;
  }
  splash.addEventListener("animationend", (event) => { if (event.target === splash) remove(); });
  window.setTimeout(remove, 700);
}

/** Same composition as the HTML splash for runtimes that start without it (tests, hot reloads). */
export function BootSplash() {
  return <div id={splashId} className="boot-splash" role="status" aria-live="polite">
    <div className="boot-stage">
      <div className="boot-mark" aria-hidden="true"><span className="boot-orbit" /><span className="boot-y">Y</span></div>
      <p className="boot-word"><strong>Yeisme</strong><span>Control Center</span></p>
      <div className="boot-status"><p className="boot-note">正在连接控制中心…</p><p className="boot-slow">连接比平时慢。<a href="./">重新加载</a></p></div>
    </div>
  </div>;
}
