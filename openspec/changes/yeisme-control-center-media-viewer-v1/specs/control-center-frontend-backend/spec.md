# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: visual results preview in a full-screen viewer

The system MUST open image, video and text previews in a full-screen viewer with one click from any result surface, MUST let the user step through the visual results of the current view without opening the Inspector, and MUST request each item's short-lived preview handle only when that item is shown.

#### Scenario: preview from the asset gallery

- Given an authorized image result in the asset gallery
- When the user clicks its preview control
- Then the viewer shows the image, writes only the `preview` query, leaves the Inspector closed, and ArrowRight shows the next visual result in the current filter order.

#### Scenario: Escape closes one layer at a time

- Given the task Inspector is open and the user opened a preview from it
- When the user presses Escape
- Then only the viewer closes, the `preview` query is cleared, focus returns to the control that opened it and the Inspector stays open.

#### Scenario: a step that cannot be read keeps the current item

- Given the viewer shows a shared project result and the next item's task read fails
- When the user steps to the next item
- Then the viewer keeps showing the current item, announces the failure inside the viewer, and a later step that succeeds clears the message.

### Requirement: accessibility baseline on primary pages

The system MUST keep the primary workspace pages free of serious and critical axe violations, including the media viewer and the Inspector preview poster.

#### Scenario: audit of the primary pages

- Given the rich fixture scenario signed in at 1440×900
- When axe runs on each primary page and on the open viewer
- Then it reports no serious or critical violations.
