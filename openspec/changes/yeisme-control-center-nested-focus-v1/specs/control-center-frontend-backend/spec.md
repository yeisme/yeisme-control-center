# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: Focus returns to the button that opened the viewer, also inside a detail panel

The system MUST keep a result's preview and download buttons mounted and focusable while their request is in flight. It MUST show progress on such a button and ignore repeated presses. When the full-screen viewer closes, by Escape, the close button or browser Back, focus MUST return to the button that opened it, including when that button sits inside a detail panel.

#### Scenario: closing a viewer opened from the task inspector

- Given the task inspector is open and the user pressed its 预览 button to open a result in the viewer
- When the user closes the viewer with Escape, the close button or browser Back
- Then the inspector stays open and focus is on the same 预览 button.

#### Scenario: downloading from the keyboard

- Given focus is on a result's 下载 button
- When the user presses Enter and the download handle is being requested
- Then the button shows progress, ignores further presses, and keeps focus after the download starts.
