# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: The accessibility gate covers the dark theme

The system MUST run the same serious and critical axe checks in the dark theme as in the light theme. This covers the desktop pages and overlays, the phone layout, and the degraded source notices. Any serious or critical violation in either theme MUST fail the browser journey and leave the violations as evidence.

#### Scenario: a dark-theme contrast regression

- Given a component renders a light-only color that falls below the contrast threshold on the dark canvas
- When the browser journey runs its dark-theme accessibility check
- Then the check fails and names the page or overlay, with the violations saved under a name ending in `@dark`.

#### Scenario: the dark pass leaves no preference behind

- Given the dark-theme checks entered the dark theme by emulating the system preference
- When they finish, whether they passed or failed
- Then the system preference is light again, no theme preference is stored, and the next check starts from the home page.
