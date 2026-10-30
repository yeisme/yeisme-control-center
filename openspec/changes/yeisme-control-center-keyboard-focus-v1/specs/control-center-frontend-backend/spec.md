# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: keyboard movement in result lists

The system MUST let keyboard users move between the items of the task, asset, request and reminder lists with the arrow keys, MUST open an item's details with Enter on that item, and MUST return focus to the selected item's row whenever its details close and focus would otherwise fall to the page body.

#### Scenario: keyboard-only task review

- Given the task list with a task that has a previewable visual result
- When the user presses `/`, types the task name, presses ArrowDown, Enter, Tab to the row's preview, Enter, then Escape twice
- Then the search field receives the text, the first matching row gains focus, the details open, the viewer opens and closes, the details close, and focus is inside the original row.

#### Scenario: details opened with the mouse

- Given the user opened a task's details by clicking a non-button part of its row
- When the user presses Escape
- Then the details close and focus moves to that task's row button instead of the page body.

#### Scenario: skip to content under hash routing

- Given any workspace page
- When the user tabs to the skip link and presses Enter
- Then focus moves to the main content and the route does not change.

### Requirement: page shortcuts and command palette actions

The system MUST focus the current page's search field on `/`, MUST open a shortcut reference on `?`, MUST ignore both while the user is typing or a dialog is open, and MUST offer recently opened items and theme, scope and shortcut actions in the command palette without persisting content beyond the current tab and identity.

#### Scenario: shortcut reference

- Given no text field has focus and no dialog is open
- When the user presses `?`
- Then a dialog lists the global, list and viewer shortcuts and Escape closes it.

#### Scenario: recent items stay within scope and session

- Given the user opened a task in one scope
- When the user opens the command palette with an empty query
- Then the task appears under recent items, it does not appear after switching to another scope, and logging out clears the list.
