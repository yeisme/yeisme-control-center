import { useState, type KeyboardEvent } from "react";
import { Keyboard, RotateCcw } from "../../icons";
import { useAccountPreferences } from "../../app/preferences";
import { useKeymap } from "../../app/keymap";
import { Button, Kbd, cx } from "../../components/ui";
import { bindingProblem, chordText, chordTokens, keyCommands, keyGroups, leaderKey, stepFromEvent, type KeyCommand } from "../../shared/keymap";
import { modKeyLabel, isApplePlatform } from "../../shared/platform";

/**
 * The shortcuts a person can change, grouped as in the reference. 「改键」 records the next key press (Esc cancels); a key
 * that is taken or reserved is refused with the reason, and every change can go back to the default.
 */
export function KeymapEditor() {
  const { prefs, update } = useAccountPreferences();
  const keymap = useKeymap();
  const modifier = modKeyLabel(isApplePlatform());
  const [capturing, setCapturing] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const changed = Object.keys(prefs.keymap).filter((id) => keyCommands.some((command) => command.id === id && command.rebindable));
  const save = (id: string, chord: string | null) => update((current) => {
    const next = { ...current.keymap };
    if (chord) next[id] = chord; else delete next[id];
    return { ...current, keymap: next };
  });
  const record = (command: KeyCommand, event: KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") { setCapturing(null); return; }
    const step = stepFromEvent(event);
    if (!step) return;
    const chord = command.group === "跳转" ? `${leaderKey} ${chordText([step])}` : chordText([step]);
    const others = Object.fromEntries(Object.entries(keymap).filter(([id]) => id !== command.id));
    const why = bindingProblem(command.id, chord, others);
    setCapturing(null);
    if (why) { setProblem({ id: command.id, text: why }); return; }
    setProblem(null);
    const isDefault = command.keys.includes(chord);
    save(command.id, isDefault ? null : chord);
  };
  return <div className="space-y-5" data-keymap-editor>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-body-sm text-muted">点「改键」，再按下新的键；按 Esc 取消。跳转都以 <Kbd>{leaderKey}</Kbd> 开头，只改第二个键。</p>
      <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} disabled={!changed.length} disabledReason="都是默认的快捷键" onClick={() => { setProblem(null); update((current) => ({ ...current, keymap: {} })); }}>全部恢复默认</Button>
    </div>
    {keyGroups.map((group) => {
      const commands = keyCommands.filter((command) => command.group === group && command.rebindable);
      if (!commands.length) return null;
      return <section key={group} aria-labelledby={`keymap-${group}`}>
        <h3 id={`keymap-${group}`} className="text-2xs font-medium text-muted">{group}</h3>
        <ul className="mt-2 divide-y divide-line rounded-[14px] border border-line">
          {commands.map((command) => {
            const custom = prefs.keymap[command.id] !== undefined && keymap[command.id]?.[0] !== undefined && !command.keys.includes(keymap[command.id]![0]!);
            const recording = capturing === command.id;
            return <li key={command.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-keymap-row={command.id}>
              <span className="min-w-0 flex-1 text-body-sm text-ink">{command.label}{custom && <span className="ml-2 text-2xs text-muted">（已改）</span>}</span>
              <span className="flex items-center gap-1" data-keymap-current>
                <span className="sr-only">当前快捷键：</span>
                {(keymap[command.id] || []).flatMap((chord) => chordTokens(chord, modifier)).map((token, index) => <Kbd key={`${token}-${index}`}>{token}</Kbd>)}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  data-key-capture={recording ? "" : undefined}
                  aria-label={recording ? `按下新的键…（${command.label}，Esc 取消）` : `改键：${command.label}`}
                  onClick={() => { setProblem(null); setCapturing(recording ? null : command.id); }}
                  onKeyDown={recording ? (event) => record(command, event) : undefined}
                  onBlur={() => { if (recording) setCapturing(null); }}
                  className={cx("h-8 rounded-control border px-3 text-[13px] font-medium transition-[border-color,background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus/20", recording ? "border-primary bg-primary-soft/60 text-ink" : "border-line text-ink-soft hover:border-line-strong hover:text-ink")}
                >
                  {recording ? <span className="inline-flex items-center gap-1.5"><Keyboard className="size-3.5" />按下新的键…</span> : "改键"}
                </button>
                {custom && <Button size="sm" variant="ghost" onClick={() => { setProblem(null); save(command.id, null); }} aria-label={`恢复默认：${command.label}`}>恢复默认</Button>}
              </span>
              {problem?.id === command.id && <p role="alert" className="w-full text-2xs text-warning">{problem.text}</p>}
            </li>;
          })}
        </ul>
      </section>;
    })}
  </div>;
}
