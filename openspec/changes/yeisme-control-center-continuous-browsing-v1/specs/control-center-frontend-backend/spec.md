# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: audio plays through the list it was started from

The system MUST queue the playable audio results of the list a track was started from, MUST let the user move to the previous and next queued track from the floating player and the operating-system media keys, and MUST start the next track automatically only when the user has turned continuous play on.

#### Scenario: reviewing dialogue lines in a row

- Given an asset list with several playable audio results
- When the user plays the first one and presses next in the floating player
- Then the second result plays, the player shows its position in the queue, and the list does not need to be reopened.

#### Scenario: continuous play is opt-in

- Given continuous play is off
- When a queued track ends
- Then playback stops without requesting the next track's handle; after the user turns continuous play on, the next track starts when the current one ends.

### Requirement: the viewer shows the set and compares two images

The system MUST show the current view's results as a strip in the full-screen viewer using only owner-provided thumbnails, MUST let the user jump to any item from the strip, and MUST let the user compare the current image side by side with another image without requesting a new handle for the pinned one.

#### Scenario: comparing two candidates

- Given the viewer shows an image and the view has more images
- When the user starts a comparison and steps to the next image
- Then the first image stays on the left, the next image appears on the right, the strip marks both, and Escape ends the comparison before it closes the viewer.
