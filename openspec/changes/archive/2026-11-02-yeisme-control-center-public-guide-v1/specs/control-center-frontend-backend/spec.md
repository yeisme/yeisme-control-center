# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: The guide is a public page

The system MUST serve the usage guide at `guide.html` to visitors without a session. The page MUST NOT call the control-center API, read account, owner or tool-catalog data, or set cookies. It MUST keep the chosen tool and client in its address. A signed-out visit to the in-app guide address MUST land on the public page with the same choices, and the sign-in screen MUST link to it.

#### Scenario: a visitor without an account

- Given a browser with no session
- When it opens `guide.html?tool=sonora&client=codex`
- Then the full guide shows with Sonora and Codex selected, and no request goes to `/api/`.

### Requirement: Static files serve media correctly

The server MUST serve guide media with its media type and MUST honour a single byte range (206, or 416 when unsatisfiable). It MUST answer a missing file that has an extension with 404 rather than the app's HTML. Only content-hashed assets MAY be cached long term, and the content policy MUST forbid plugins and foreign form targets.

#### Scenario: a video seeks

- Given a video file in the built guide
- When the browser requests `Range: bytes=0-99`
- Then the server answers 206 with exactly those bytes and `Content-Range: bytes 0-99/<size>`.
