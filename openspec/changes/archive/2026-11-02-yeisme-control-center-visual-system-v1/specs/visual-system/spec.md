# Visual System Specification

## ADDED Requirements

### Requirement: readable source facts

The system MUST render owner and catalog enums through a shared label dictionary. The system MUST NOT show raw snake_case enums or JSON bodies as primary content. Raw JSON MAY appear only inside an explicit, collapsed disclosure.

#### Scenario: work item stage

- Given a work queue item whose stage is a snake_case code
- When the Inspector renders it
- Then the user sees a readable label.

### Requirement: container-driven lists

List tables MUST choose visible columns from their own container width, not from the viewport. The system MUST hide lower-priority columns before wrapping text one character per line.

#### Scenario: docked inspector

- Given a 1440px viewport with the right Inspector docked
- When the task or catalog list renders
- Then lower-priority columns are hidden and metadata does not wrap one character per line.

### Requirement: validated chart identity

Owner chart series MUST use the validated categorical palette in fixed order, both in light and dark themes. Status colors MUST NOT be reused as series colors, and chart text MUST stay in ink colors.

#### Scenario: four owners

- Given usage rows from Eikona, Scaena, Sonora and Aigora
- When the usage chart renders
- Then each owner keeps its own series color regardless of filtering.

### Requirement: accessible overlays

When the Inspector is modal (drawer or maximized), focus MUST move into the panel and Tab MUST cycle within it. Disabled actions MUST expose their reason to hover and keyboard focus.

#### Scenario: disabled submit

- Given the Provider submit gate is closed
- When a keyboard user focuses the disabled submit action
- Then the reason is announced through a tooltip.
