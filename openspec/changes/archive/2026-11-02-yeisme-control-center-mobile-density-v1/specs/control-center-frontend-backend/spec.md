# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: list pages put the first result on a phone's first screen

The system MUST show the first result of the task, asset, request and reminder lists within the first 400 pixels of a 390×844 viewport, MUST keep page context, notices and filters reachable from a single expandable line or a filter drawer, and MUST leave the desktop layout unchanged.

#### Scenario: task list on a phone

- Given a 390×844 viewport and a scope with tasks and a stale-data notice
- When the user opens the task center
- Then the first task row starts above y=400, the notice shows as one expandable line, and the page description and source cards appear after the user expands the status line.

#### Scenario: filters in a drawer

- Given a 390×844 viewport on the asset library
- When the user opens the filter drawer and picks a source
- Then the drawer closes on done, the list is filtered, the filter button shows one active filter, and the same URL parameter is written as on desktop.
