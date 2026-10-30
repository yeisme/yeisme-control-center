# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: A page whose code is already loaded opens without a loading placeholder

The system MUST render a route page directly when its code has already been loaded, whether by the idle prefetch after sign-in or by an earlier visit. It MUST show the page-shaped loading placeholder only while the page's code is still loading. It MUST NOT remount a page that is already on screen when its code finishes loading.

#### Scenario: first visit after the idle prefetch

- Given the user signed in and the page chunks were prefetched while the browser was idle
- When the user opens a page from the sidebar for the first time
- Then the page renders without the page-shaped placeholder appearing.

#### Scenario: a cold deep link

- Given the user opens a link straight to a page before its code has loaded
- When the page code is still loading
- Then the page-shaped placeholder is shown until the page renders.
