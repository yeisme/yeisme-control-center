# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: A table's main column stops growing on wide screens and never widens the table

The system MUST fix a table's main column (the column that names the row) at 560px once the table is wide enough that a wider main column would only add empty space before the next column, MUST let the other columns share the remaining width, and MUST keep a single long line in the main column from widening the table beyond its container at any width.

#### Scenario: the task list on a 1920px screen

- Given the task center is shown on a 1920px-wide screen
- When the task list renders
- Then its main column is 560px wide and the other columns share the rest of the table.

#### Scenario: stacked catalog tables line up

- Given the tools tab of models and tools is shown on a screen at least 1536px wide
- When the MCP tool and action tables render one above another
- Then every table's main column is 560px wide, so the columns after it start at the same position.

#### Scenario: a long owner description

- Given an owner returns a one-line description far longer than the main column
- When the catalog table renders it
- Then the description is truncated within the column and the table does not scroll horizontally.

### Requirement: Rows of an asset list keep one rhythm across media kinds

The system MUST give audio and video rows in the asset lists a media slot the same size as an image thumbnail, so that names start at the same position and rows keep the same height regardless of media kind.

#### Scenario: a compact list mixing images and audio

- Given the asset library shows the compact list with image, audio and video results
- When the rows render
- Then every result name starts at the same horizontal position and every row has the same height.
