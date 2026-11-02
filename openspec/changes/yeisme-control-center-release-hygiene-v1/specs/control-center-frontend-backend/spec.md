# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: Only the served entries are sent, built and released

The control center MUST send only the files named in `servedEntries` (`index.html`, `guide.html`, `favicon.svg`, `favicon.ico`, and the subtrees `assets/`, `guide/`, `v18/`) from its built directory, and MUST answer every other real file there with 404, whether it is asked for directly or through dot segments or encodings. A page address that is not a file SHALL still fall back to the app's index page. The production build MUST NOT copy `docs/` into `dist/` and MUST remove every top-level entry of `dist/` that is not served, without deleting anything in `public/`. Release preparation and deployment preparation MUST copy only the served entries. The public-surface check MUST fail when an existing `dist/` holds an entry outside the list.

#### Scenario: a source archive and the docs sit in the built directory

- **WHEN** the built directory contains `source.zip` and `docs/README.md` and a client asks for `/source.zip`, `/docs/README.md`, `/assets/../source.zip` or `/docs/third-party/geist-LICENSE`
- **THEN** every answer is 404 with no file, and `/`, `/guide.html` and files under `assets/`, `guide/` and `v18/` are still served

#### Scenario: the build is checked

- **WHEN** `vite build` finishes with an ignored `public/source.zip` present and `check:public-surface` runs
- **THEN** `dist/` holds no `source.zip` and no `docs/`, `public/source.zip` itself is untouched, and the check passes; with a stray `dist/docs/README.md` it fails with `unserved-dist-entry`

### Requirement: A release candidate is built here, from a recorded commit

`prepare-intranet-release.ts` MUST run the production build itself instead of copying an existing `dist/`, and MUST record `source_commit`, `dirty`, `dirty_allowed` and `changed_files` in its evidence. It MUST refuse to build when tracked files differ from HEAD unless `YEISME_RELEASE_ALLOW_DIRTY=1` is set; untracked and ignored files MUST NOT count as dirty. A refusal MUST leave a failed summary with `failure: dirty_working_tree` and MUST NOT build or copy anything.

#### Scenario: a tracked file is modified

- **WHEN** the working tree has a modified tracked file and the candidate is prepared without the allowance
- **THEN** the summary is `failed` with `dirty_working_tree`, the number of differing files is recorded, and no build runs

#### Scenario: only untracked files exist, or the allowance is given

- **WHEN** the tree holds untracked files only, or has tracked changes and `YEISME_RELEASE_ALLOW_DIRTY=1` is set
- **THEN** the candidate builds; in the second case the evidence records `dirty: true` and `dirty_allowed: true`

### Requirement: Releases are read back as a viewer

The authenticated read-back MUST sign in exactly once per run, using an access key from a private (0600) probe file, and MUST NOT retry the login. It MUST check that the session's role is viewer; that `/services` without `observe=1` contains no `credential_ref`, key or password hash reference and no home directory path; that `/notifications` answers 200; that `/observation/status` answers 200 or 404, recording 404 as absent; that `/admin/personal-users`, `/audit` and a preview of `admin.user.revoke` are refused with 403; and that logout succeeds and ends the session. Its result and evidence MUST NOT contain the access key, the session cookie, the address or any response body. When `YEISME_RELEASE_PROBE_FILE` is set, `control-release.ts` MUST read the probe file before changing anything, run the read-back after activation and the static checks, and record `verification.authenticated_read`; any 5xx answer MUST take the existing rollback path, while a refused login (401), a rate-limited one (429) or any other failed check MUST mark the read-back failed without rolling back.

#### Scenario: the viewer read-back passes

- **WHEN** the read-back runs against a release with a viewer account
- **THEN** one login is made, every check passes or is absent, the session is closed, and the evidence has statuses and short codes only

#### Scenario: the server fails or refuses the probe

- **WHEN** the release answers 5xx during the read-back, or answers the login with 401 or 429
- **THEN** a 5xx rolls the release back, while 401 and 429 leave it in place with `authenticated_read` false and the failure code recorded

### Requirement: Candidates are verified apart from live services

`verify-release-component.ts` MUST start the candidate on `YEISME_RELEASE_VERIFY_PORT` or 4380 and MUST NOT default to 4313. It MUST run the candidate with `YEISME_CONTROL_BACKGROUND=off` and with observation disabled in its isolated configuration, MUST confirm that `/source.zip` and `/docs/README.md` are 404, and MUST run the viewer read-back against the candidate with a throwaway viewer created only in the isolated configuration. It MUST NOT write the live configuration.

#### Scenario: a candidate is verified

- **WHEN** the component verification runs for a candidate
- **THEN** the candidate listens on the verification port only, background reads are off, the unserved files are refused, the throwaway viewer's read-back passes, and the isolated directory is removed afterwards

### Requirement: Account commands keep keys off the screen and end old sessions

`personal-config user add` MUST write the one-time access key to a new 0600 file named by `--key-file`, MUST NOT print it, and MUST refuse a key file that already exists before writing anything; without `--key-file` it SHALL keep printing the key once. `user rotate` MUST replace the account's key digest atomically so that the account's existing sessions stop working on their next request and only the new key signs in. `user enable` MUST restore a revoked account. `observe on|off` MUST write `config.observation` and MUST reject an interval below 5 minutes, an `open_tools_every` below 1, and malformed recipients without rewriting the file; the defaults are 10 and 3.

#### Scenario: a key is issued to a file

- **WHEN** an operator adds a viewer with `--key-file` naming a new path
- **THEN** the file exists with mode 0600 and holds a key that matches the stored digest, the command output contains no key, and naming an existing file fails with nothing written

#### Scenario: a key is rotated

- **WHEN** an account with a live session is rotated
- **THEN** the session's next request is 401, the old key no longer signs in, the new key does, and the configuration file is unchanged

### Requirement: Account changes through the server touch only the account list

When an administrator creates or revokes a personal account through the server, the server MUST read the configuration file again, MUST replace only `personal.users`, and MUST write the result through a temporary file renamed over the original with mode 0600. It MUST NOT write values that came from the environment, and MUST keep edits made to the file and accounts added with `personal-config` since the server started. When the file cannot be read, creating an account MUST fail with 503 and leave no account and no key digest behind, and a revocation MUST still take effect in memory at once.

#### Scenario: the file was edited while the server ran

- **WHEN** `observation` and an extra account were written to the file after start and the server then creates another account
- **THEN** the file keeps `observation` and both accounts, holds no environment-derived provider or bind value, and has no temporary file left beside it

### Requirement: Workflows match the scripts they call

The CI workflow MUST run `test:server-boot` and, after the production build, `test:public-guide`. The Provider canary workflow MUST take only USD budgets (`total_usd`, `image_usd`, `video_usd`, `audio_usd`) with `run_label` and `modality` required, MUST pass every input to the script through `env:` and MUST NOT place an expression inside a `run:` step. The script's arguments MUST be parsed by one module that rejects CNY flags, unknown flags, repeated flags and a flag without a value. Every `bun run` script named by a workflow MUST exist, and the retired `test:task-visibility` MUST NOT remain.

#### Scenario: the canary workflow is dispatched

- **WHEN** the workflow's inputs are filled in and expanded the way the shell expands them
- **THEN** the script's argument parser accepts the result, and an input whose value looks like a flag is rejected rather than read as one
