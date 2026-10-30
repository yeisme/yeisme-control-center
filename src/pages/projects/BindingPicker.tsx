import { useMemo } from "react";
import { Checkbox, InlineNotice, Pill, ownerLabel } from "../../components/ui";
import { useScopedRead } from "../../app/workspace";
import { api } from "../../shared/api/control-center-client";
import { maxProjectBindings, type BindingOption, type ProjectBinding } from "../../shared/collaboration";

type BindingRef = Pick<ProjectBinding, "owner" | "project_ref" | "source_scope">;

export const bindingKey = (b: BindingRef) => `${b.source_scope}\u0000${b.owner}\u0000${b.project_ref}`;

/** Only the fields the server reads; it rebuilds connection ids itself and rejects unknown keys. */
export const plainBinding = (b: ProjectBinding): ProjectBinding => ({ owner: b.owner, project_ref: b.project_ref, source_scope: b.source_scope, connection_ids: b.connection_ids });

/** Local names of the tool projects this identity reads, keyed like bindings; projects without one are absent. */
export function useToolProjectNames() {
  const owned = useScopedRead((scope, signal) => api.ownerProjects(scope, signal));
  return useMemo(() => new Map((owned.data?.rows || []).filter((r) => r.display_name).map((r) => [bindingKey({ source_scope: r.scope_id, owner: r.owner, project_ref: r.project_ref }), r.display_name])), [owned.data?.rows]);
}

/** "Eikona ×2 · Sonora": tools first, how many projects of each. */
export function bindingSummary(bindings: ProjectBinding[]) {
  if (!bindings.length) return "未关联工具项目";
  const counts = new Map<string, number>();
  for (const b of bindings) counts.set(b.owner, (counts.get(b.owner) || 0) + 1);
  return [...counts].map(([owner, n]) => `${ownerLabel(owner)}${n > 1 ? ` ×${n}` : ""}`).join(" · ");
}

/** Tool projects grouped by tool; several projects of one tool may be chosen, at most `maxProjectBindings` in all. */
export function BindingPicker({ options, value, names, scopeLabels, onChange }: { options: BindingOption[]; value: ProjectBinding[]; names?: ReadonlyMap<string, string>; scopeLabels?: ReadonlyMap<string, string>; onChange: (next: ProjectBinding[]) => void }) {
  if (!options.length) return <InlineNotice>当前身份没有可关联的工具项目。可以先在“工具项目”页接入。</InlineNotice>;
  const selected = new Set(value.map(bindingKey));
  const full = value.length >= maxProjectBindings;
  const owners = [...new Set(options.map((o) => o.owner))];
  // Several scopes of the tenant can offer the same project ref; then each option says where it comes from.
  const manyScopes = new Set(options.map((o) => o.source_scope)).size > 1;
  return (
    <div className="space-y-4" data-binding-picker>
      <p className="text-xs text-muted">同一工具可以关联多个项目，最多 {maxProjectBindings} 个。已选 {value.length} 个。</p>
      {owners.map((owner) => (
        <fieldset key={owner} className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-ink">{ownerLabel(owner)}</legend>
          {options.filter((o) => o.owner === owner).map((o) => {
            const key = bindingKey(o);
            const checked = selected.has(key);
            const name = names?.get(key);
            return (
              <label key={key} data-binding-option={`${o.owner}:${o.project_ref}`} className="flex items-center gap-3 rounded-control border border-line p-3 text-sm">
                <Checkbox
                  checked={checked}
                  disabled={!checked && full}
                  label={`${ownerLabel(o.owner)} ${name || o.project_ref}${manyScopes ? `（${scopeLabels?.get(o.source_scope) || o.source_scope}）` : ""}`}
                  onChange={() => onChange(checked ? value.filter((v) => bindingKey(v) !== key) : [...value, plainBinding(o)])}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{name || o.project_ref}</span>
                  {(name || manyScopes) && <span className="block truncate text-2xs text-muted">{[name ? o.project_ref : "", manyScopes ? `来自 ${scopeLabels?.get(o.source_scope) || o.source_scope}` : ""].filter(Boolean).join(" · ")}</span>}
                </span>
                {o.pinned && <Pill size="sm">默认项目</Pill>}
                {o.registered && <Pill size="sm" tone="info">控制中心接入</Pill>}
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
