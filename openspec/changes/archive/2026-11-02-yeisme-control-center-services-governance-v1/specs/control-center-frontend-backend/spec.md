# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: The services directory folds registered-only entries into one closed group

The services page MUST list the directory entries that are integrated, or that someone configured, in the directory table, and MUST fold every other entry whose `integration` is `not_integrated` into one group titled 「未接入」 that is closed by default. The group's title MUST be a heading that holds a button carrying `aria-expanded` and `aria-controls`, the panel it controls MUST stay in the page and be `hidden` while the group is closed, and the title MUST show how many entries the group holds (`17 项`, or `3 / 17 项` while a filter or a search keeps only some of them). Whether the group is open SHALL be remembered in this browser (local storage key `yeisme.control.services.unintegrated-open`, `1` for open), be closed until someone opens it, and an unusable storage MUST NOT break the page. While a search text is entered or the 缺口 filter is chosen, the matching entries of the group MUST be listed at once under a title that is not a button, and the remembered choice MUST be left as it was. The rows of the group MUST NOT repeat the integration line or a status pill, because its title already says so. An entry whose `integration` is `not_integrated` but whose `configuration` is `configured` MUST stay in the directory table.

#### Scenario: the default view

- **WHEN** the directory has 8 integrated entries and 17 registered-only entries and nothing was remembered
- **THEN** the directory table lists the 8, the group 「未接入」 shows `17 项` with its button reporting `aria-expanded="false"`, and the 17 entries are not visible

#### Scenario: opening is remembered

- **WHEN** the button is pressed with Enter, the page is reloaded, and the button is pressed again
- **THEN** the group opens and lists the 17 entries, it is still open after the reload, and it is closed again after the second press, with the value `1` and then `0` kept under the storage key

#### Scenario: a search asks for the entries

- **WHEN** 「pinax」 is typed into the directory search while the group is closed
- **THEN** the group lists the one matching entry under the title `1 / 17 项` with no button, the directory table does not claim there is no match, and clearing the search returns the group to the remembered closed state

#### Scenario: a registered-only entry that was configured

- **WHEN** an entry whose `integration` is `not_integrated` has `configuration` `configured`
- **THEN** it is listed in the directory table and is not counted in the group

### Requirement: One short label names the state of waiting for an owner contract

Every chip, pill, column value and metric hint that shows the state `needs_contract`, meaning the source is known to exist but its owner has not provided an interface the control center can use, MUST use the one word 「待补齐接口」, taken from `needsContractLabel` in `src/shared/read-model/labels.ts`, and MUST NOT spell it 「待接入」, 「待接口」 or 「待合同」. The word 「未接入」 belongs only to the services directory's group of entries the control center has no contract for, so that no page shows both words for one state. Sentences that explain the gap MAY keep their own words.

#### Scenario: the same state reads the same everywhere

- **WHEN** the request coverage, the read status, the open tool state and its read checks, the process timeline, the catalog coverage, the provider readiness, the source coverage strip, the drama stage rail, the work queue inspector, the catalog's pending panel and the MuWeave hand-off row show `needs_contract`
- **THEN** each of them says 待补齐接口, and none of them says 待接入, 待接口 or 待合同

### Requirement: The guide's pickers are radio groups that the keyboard can drive

The guide's pickers (选择工具, 选择 Agent 客户端, 选择回放的客户端) and the public guide page's theme switch MUST follow the WAI-ARIA radio group pattern: the checked radio, or the first when none is checked, SHALL be the one tab stop of its group (`tabindex` 0, the others −1); ← and ↑ MUST move to the previous radio and → and ↓ to the next, moving focus to it and checking it, going round from the last to the first and back; Home and End MUST go to the first and the last. A key pressed with Ctrl, Alt, Meta or Shift, and a key the group does not use, MUST be left to the browser. The movement MUST be computed with `moveIndex` from `src/shared/keyboard.ts`. The chapter bar `nav[aria-label="指南章节"]` MUST stay a list of real links, each an ordinary tab stop, the current one marked `aria-current="page"`.

#### Scenario: arrow keys inside a picker

- **WHEN** focus is on the checked tool and → is pressed, then End, then ↓
- **THEN** the next tool is checked and focused, then the last, then the first, and the address names the chosen tool each time

#### Scenario: Tab passes through a picker once

- **WHEN** focus is on the checked tool and Tab is pressed
- **THEN** focus moves out of the tool picker to the client picker's checked radio, not to the next tool

#### Scenario: the keys are wired in the browser

- **WHEN** the public guide is opened and the keyboard drives the tool picker, the client picker and the theme switch
- **THEN** each group has one tab stop on its checked radio, →, ←, ↑, ↓, Home and End move focus and the choice (wrapping at the ends), Shift+→ does nothing, and Tab leaves the group

#### Scenario: keys the group does not use

- **WHEN** Alt+→, Enter or Tab is pressed on a radio, or End is pressed on the last radio
- **THEN** the choice does not change and the key's default is not prevented

### Requirement: A credential that does not expire is recorded as never

`credential_expires_at`, and `flow_credential_expires_at` for Auctra's reader key, MAY hold the exact lowercase word `never`. `credentialStatuses()` MUST judge a slot with that record by everything else first (an unreadable file, a refusal and a limited read keep their place in the fixed order) and otherwise as `ok`, with no `expires_at`, `days_left` or `stage`, and with `never_expires: true` on its row; its chip MUST read 「不过期」, and it MUST NOT count as a slot with no recorded expiry. `parseRfc3339` MUST keep refusing everything that is not an RFC 3339 time with seconds and a zone; any other value that is not such a time, including `Never`, `NEVER`, `forever`, `none`, a padded `never` and a bare date, MUST still be a recorded expiry that cannot be read (`unknown_expiry` with reason `invalid_expiry`).

#### Scenario: a never-expiring key

- **WHEN** a connection's `credential_expires_at` is `never` and its file is a private, non-empty file that the owner accepts
- **THEN** its row is `ok` with `never_expires` true and without `expires_at` or `days_left`, at any later date, and its card footer and panel row say 不过期

#### Scenario: something else is wrong with it

- **WHEN** the file is group-readable, or the owner denies the credential, or only content access is denied
- **THEN** the row is `unreadable` with reason `permissions`, `rejected`, or `limited`, and keeps `never_expires`

#### Scenario: only the exact word

- **WHEN** the record is `Never`, ` never`, `forever` or `9999-12-31T23:59:59` (no zone)
- **THEN** the row is `unknown_expiry` with reason `invalid_expiry`

#### Scenario: Auctra's two keys

- **WHEN** the collector key records `never` and the reader key records a date three days away
- **THEN** the collector slot is `ok` and the reader slot is `expiring` at stage `7d`

### Requirement: personal-config records never for an expiry only

`personal-config` MUST accept the exact word `never` as an expiry and store it as the string `"never"`: as `--expires-at never` on `connect`, `open-tool`, `provider`, `auctra` (for both of its keys) and `credential replace`, and as `credential <config-file> expiry <slot> never`. It MUST refuse every other value that is not a strict RFC 3339 time (`Never`, `forever`, a bare date, an empty value) and MUST refuse `never` as `--issued-at`, as `--expires-in`, or together with `--expires-in`, leaving the configuration file byte for byte unchanged and its inode as it was; an issue time MUST NOT make `never` invalid. A re-run or `--replace` that names the same credential file MUST keep a recorded `never` unless a new expiry is given, one that names another file MUST clear it with the usual notice, and `credential list` MUST print `expires_at: "never"` and no `days_left` for such a slot. The error for a refused expiry MUST name the word `never` as acceptable, and the error for a refused issue time MUST NOT.

#### Scenario: never in every command that takes an expiry

- **WHEN** `connect`, `open-tool`, `provider` and `auctra` are run with `--expires-at never`, then `credential … expiry open_tool:gateway never` and `credential … replace connection:<id> <file> --expires-at never`
- **THEN** each stores `"never"` next to its credential reference (both Auctra keys for `auctra`), `connect` says the credential never expires, and `replace` prints no notice

#### Scenario: nothing else passes for it

- **WHEN** `Never`, `NEVER`, ` never`, `forever`, `infinite`, `2026-11-30` and the empty string are given as an expiry, and `never` is given as `--issued-at` or `--expires-in`
- **THEN** every command exits with an error and the configuration file is unchanged

#### Scenario: the same file keeps it

- **WHEN** `open-tool … --replace` is run with a new address and the same credential file, and then with another file
- **THEN** the first keeps `never` and reports `expiry_kept`, and the second clears it and reports `expiry_cleared`

### Requirement: observe refuses what the server would treat as invalid

`personal-config observe` MUST take its bounds from `observationBounds` in `server/observation-config.ts` and MUST check the whole `observation` block it is about to write with `observationProblems`, refusing a block that the server would treat as invalid and writing nothing: an interval outside 5 to 1440 minutes, `open_tools_every` outside 1 to 1000, more than 100 recipients, a recipient longer than 200 characters, or a problem an earlier hand edit left in the block. The refusal MUST name the problem codes and MUST NOT print any value from the block. The most the server accepts MUST be accepted: exactly 100 recipients, and a recipient of exactly 200 characters.

#### Scenario: the limits are the server's

- **WHEN** `observe on --recipients` is given 100 entries, then 101, then one entry of 200 characters, then one of 201
- **THEN** the first and third are written and pass `observationProblems`, and the second and fourth are refused with the file unchanged

#### Scenario: a block that a hand edit made invalid

- **WHEN** the configuration holds an `interval_minutes` of 3 and `observe on --recipients <entry>` is run
- **THEN** it is refused with `observation_interval_out_of_range` and writes nothing, and `observe on --interval-minutes 10 --recipients <entry>` repairs it

### Requirement: observe refuses an existing observation block that is not an object

When the configuration's `observation` is present and is not an object (a string, a number, a boolean or an array; `null` counts as absent, as on the server), `personal-config observe` MUST refuse with `observation_not_an_object`, MUST write nothing and MUST NOT spread the value into the new block; no flag can repair it, so the message tells the operator to correct or remove the block in the file.

#### Scenario: a hand-edited block

- **WHEN** `observation` is the string `yes` and `observe on`, `observe off`, `observe on --interval-minutes 10` or `observe on --recipients <entry>` is run
- **THEN** each exits with an error that names `observation_not_an_object` and says nothing was written, and the file and its inode are unchanged; with `observation` null, `observe on` writes a fresh block

### Requirement: The services page opens the credential a deep link names

`#/services?ref=<slot>` MUST open the credentials panel's row whose slot id is exactly `<slot>`: the row SHALL be highlighted (`data-linked`), scrolled into view and focused, and when it is among the folded healthy rows the group MUST be open from the first render. This SHALL happen once per link: a later reload of the page's data MUST NOT reopen a group the reader folded, move focus again or scroll again. A missing, empty, unknown or near-miss slot (a prefix, a different case, surrounding spaces) MUST name no row and MUST leave the page as it opens without the parameter, without an error.

#### Scenario: a refused credential and a healthy one

- **WHEN** the page is opened with `ref` set to a refused credential, and then to a credential in the folded group
- **THEN** the first row is highlighted, in view and focused with the group still folded, and the second opens the group and is highlighted, in view and focused; folding the group afterwards and re-reading the data leaves it folded

#### Scenario: nothing to find

- **WHEN** `ref` is empty, names an unknown slot, or differs from a slot only by case or by a missing suffix
- **THEN** no row is highlighted or focused, the healthy group stays folded and the page shows no error
