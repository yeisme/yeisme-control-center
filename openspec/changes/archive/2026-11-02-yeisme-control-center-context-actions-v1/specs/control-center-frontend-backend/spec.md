# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: Items offer the same actions on right click as in their menu

The system MUST open a context menu on right click for every list row and card that has actions: tasks, tool projects, shared projects, reminders, assets, requests, episodes, service connections, catalog entries, notifications and navigation entries. Each context menu MUST offer the same actions as the item's "更多操作" menu, built from one list. It MAY add opening and link actions.

#### Scenario: a tool project card

- Given a tool project card with a "更多操作" button
- When the user right-clicks the card
- Then the context menu lists the same items, in the same order, as the button's menu.

### Requirement: Context menus work from the keyboard and on touch screens

The system MUST open the context menu of the focused row on Shift+F10 or the Menu key, below that row. Closing the menu with Escape MUST return focus to the row. A long press on a touch screen MUST open the menu without also opening the row, and the menu MUST stay within the screen.

#### Scenario: keyboard

- Given focus on a task row
- When the user presses Shift+F10 and then Escape
- Then a menu opens below the row, and after Escape focus is back on the row.

#### Scenario: a long press on a phone

- Given a phone-width screen
- When the user long-presses the middle of a task row
- Then the row's menu opens inside the screen, and the task inspector does not open.

### Requirement: Menus sit above every panel

The system MUST show menus above the task inspector, detail panels and the media viewer. Escape MUST close only the topmost menu.

#### Scenario: a menu inside the task inspector

- Given the task inspector is open
- When the user opens its "更多操作" menu and presses Escape
- Then the menu is visible on top while open, and after Escape the inspector is still open.
