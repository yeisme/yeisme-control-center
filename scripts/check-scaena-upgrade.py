"""Read-only live preflight; rehearse owner migrations exclusively on a private SQLite backup."""
import datetime
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile

os.umask(0o077)
root = pathlib.Path(__file__).resolve().parent.parent
candidate = pathlib.Path(sys.argv[1]).resolve()
if not candidate.is_relative_to(root / 'temp/integration-test-runs') or candidate.name != 'scaena-api':
    raise SystemExit('Provide the prepared local scaena-api candidate.')
run = root / 'temp/integration-test-runs' / ('scaena-upgrade-preflight-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
(run / 'artifacts').mkdir(parents=True)
(run / 'command.txt').write_text('python3 scripts/check-scaena-upgrade.py ' + str(candidate) + '\n')
(run / 'env.json').write_text(json.dumps({'layer': 'compatibility', 'live_database': 'read_only', 'migration_target': 'private_disposable_backup', 'credentials_created': False, 'race': False}))
(run / 'stdout.log').write_text('')
(run / 'stderr.log').write_text('')
result = {'status': 'failed', 'production_changed': False, 'schema_changed': None}

def schema(db):
    return dict(db.execute("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"))

def counts(db, names):
    # Identifiers originate exclusively from SQLite's own catalog in this maintenance preflight.
    return {name: db.execute('SELECT COUNT(*) FROM "' + name.replace('"', '""') + '"').fetchone()[0] for name in names}

try:
    with tempfile.TemporaryDirectory(prefix='control-scaena-preflight-') as directory:
        private = pathlib.Path(directory)
        source = sqlite3.connect('file:/home/yeshugen/.config/yeisme-lan/data/scaena-production.db?mode=ro', uri=True)
        source.execute('PRAGMA query_only=ON')
        backup = sqlite3.connect(private / 'database.sqlite')
        source.backup(backup)
        source.close()
        before = schema(backup)
        before_counts = counts(backup, before)
        backup.close()
        env = {**os.environ, 'SCAENA_PREFLIGHT_TOKEN': 'disposable-preflight-only'}
        commands = [
            ['config', 'init', '--config', str(private / 'config.yaml'), '--mode', 'gateway', '--api-key-ref', 'env:SCAENA_PREFLIGHT_TOKEN', '--database-path', str(private / 'database.sqlite'), '--project-root', str(private / 'projects'), '--public-base-url', 'http://127.0.0.1:18979'],
            ['access-key', 'list', '--config', str(private / 'config.yaml'), '--json'],
        ]
        for args in commands:
            completed = subprocess.run([str(candidate), *args], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
            if completed.returncode:
                raise RuntimeError('candidate_rehearsal_failed')
            # Discard owner output: it may contain key metadata from the copied database.
        backup = sqlite3.connect(private / 'database.sqlite')
        after = schema(backup)
        remaining = counts(backup, set(before) & set(after))
        rows_preserved = all(remaining.get(name) == count for name, count in before_counts.items())
        integrity = backup.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
        backup.close()
        result.update(status='passed' if rows_preserved and integrity else 'failed', rows_preserved=rows_preserved, integrity_ok=integrity,
                      schema_changed=before != after, added_tables=sorted(set(after)-set(before)), removed_tables=sorted(set(before)-set(after)),
                      changed_tables=sorted(name for name in set(before)&set(after) if before[name] != after[name]))
except Exception as error:
    result['error_type'] = type(error).__name__
finally:
    (run / 'summary.json').write_text(json.dumps(result, indent=2) + '\n')
    (run / 'stdout.log').write_text('Disposable migration rehearsal ' + result['status'] + '. Live database was opened read-only.\n')
    if result['status'] != 'passed': (run / 'stderr.log').write_text('Rehearsal failed; owner output suppressed to protect copied metadata.\n')
    print(json.dumps({'evidence': str(run), **result}))
    sys.exit(0 if result['status'] == 'passed' else 1)
