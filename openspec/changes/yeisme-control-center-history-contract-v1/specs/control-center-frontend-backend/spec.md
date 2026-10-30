# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: Back closes the topmost overlay and closing leaves no extra history step

The system MUST add a history entry when a URL-backed overlay (inspector, detail sheet or media viewer) opens, MUST replace that entry when the user switches items while it is open, and MUST return to the entry the overlay was opened from when the user closes it, so that browser Back closes the topmost overlay without leaving the page and a closed overlay never leaves a duplicate or reopening history step.

#### Scenario: Back with an inspector open

- Given the user entered the task center from the home page and opened a task's inspector
- When the user presses the browser Back button
- Then the inspector closes and the task center stays on screen.

#### Scenario: Back after closing with Escape

- Given the user entered the request records from the home page, opened a request and closed it with Escape
- When the user presses the browser Back button once
- Then the home page is shown, rather than the request records again or the request reopened.

#### Scenario: the viewer opened from an inspector

- Given a task inspector is open and the user opened a result in the media viewer from it
- When the user presses Escape twice and then Back
- Then the first Escape closes only the viewer, the second closes the inspector, and Back returns to the home page.
