# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: A page whose code failed to load recovers by itself once

When a page's code fails to load while the browser is online, the system MUST keep the page placeholder on screen and reload the document once, at the same address. Browsers keep a failed module request failed for the rest of the document, so retrying inside the document cannot succeed. If the code fails again within a minute, the browser is offline, or session storage is unavailable, the system MUST show the page load error with a reload button and MUST NOT reload again by itself. Errors other than failed code loading MUST keep their current handling.

#### Scenario: a network blip during the idle prefetch

- Given the request for a page's code failed once while the page chunks were prefetched after sign-in
- When the user opens that page
- Then the document reloads once at the same address and the page renders.

#### Scenario: the page code keeps failing

- Given every request for a page's code fails
- When the user opens that page
- Then the document reloads once, the page load error with its reload button is shown, and no further automatic reload happens.
