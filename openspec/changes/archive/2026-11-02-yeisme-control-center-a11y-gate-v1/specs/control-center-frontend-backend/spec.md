# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: the browser journey fails on serious accessibility violations

The system MUST run an axe scan in the browser journey over every workspace page, the modal and popover overlays, the detail panels, the phone layouts and the degraded-source notices, MUST fail the journey when any scan reports a serious or critical violation, and MUST record the full violation list as evidence.

#### Scenario: a page regresses

- Given a change that removes the accessible name from a page control
- When the browser journey runs
- Then the accessibility check fails and names the page and the offending element in its evidence.

#### Scenario: a modal overlay is open

- Given the media viewer or the command palette is open
- When the journey scans it
- Then only the overlay is scanned, so the page correctly hidden behind it is not reported.

### Requirement: a control's accessible name contains the text it shows

The system MUST give every labelled control an accessible name that contains its visible text, so that speech-input users can activate it by saying what they see.

#### Scenario: a task row

- Given the task list
- When assistive technology reads the row's open button
- Then the button is named by the short row label and the row's title, owner and reference are read as plain cell text rather than hidden inside a differently named button.
