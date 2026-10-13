import { describe, expect, it } from 'vitest';
import { combineTaskPages } from '../src/task-polling';
import type { TaskPage, TaskSnapshot } from '../src/task-observation';
const connection = { id: 'a', owner: 'sonora' as const, instance_id: 'lan', label: 'Sonora', project: 'p', environment: 'test', state: 'ready', observed_at: '' };
const task = { task_key: 'key', connection_id: 'a', state: 'running' } as TaskSnapshot;
const page = (state: string, rows: TaskSnapshot[]): TaskPage => ({ rows, connections: [{ ...connection, state }], next_cursors: {} });
describe('overview history and active observations', () => {
  it('includes historical failures and prefers the later snapshot of the same original task', () => {
    const merged = combineTaskPages(page('ready', [task]), page('ready', [{ ...task, state: 'failed' }]));
    expect(merged.rows).toHaveLength(1);
    expect(merged.rows[0].state).toBe('failed');
  });
  it.each([true, false])('clears rows when either lane loses authorization (%s)', activeDenied => {
    const merged = combineTaskPages(page(activeDenied ? 'needs_authorization' : 'ready', [task]), page(activeDenied ? 'ready' : 'needs_authorization', [task]));
    expect(merged.rows).toEqual([]);
    expect(merged.connections[0].state).toBe('needs_authorization');
  });
  it('does not label an incomplete lane as ready', () => {
    expect(combineTaskPages(page('source_unavailable', []), page('ready', [task])).connections[0].state).toBe('source_unavailable');
  });
});
