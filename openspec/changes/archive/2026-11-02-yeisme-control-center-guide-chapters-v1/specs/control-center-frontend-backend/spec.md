# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: The guide is navigated by chapters from a top bar

The usage guide MUST be organised into the chapters 开始, 工具, 案例, 接入 and 排障与问答, with one page per tool under 工具. A top bar MUST list the chapters as links, mark the open one with `aria-current="page"`, and stay on screen under the page's own top bar while the reader scrolls. Every chapter, tool page and section MUST have its own address: `#/guide/<chapter>/<page>?section=` when signed in, `guide.html?chapter=&page=#<section>` on the public page. Opening another chapter MUST add a history entry, so Back returns to the previous chapter; moving within the open page MUST NOT. Old addresses that only name a tool MUST open the three steps with that tool chosen.

#### Scenario: a reader moves between chapters

- Given the guide open on 开始
- When the reader chooses 案例 in the top bar and then presses Back
- Then 案例 shows with its address and marked current, and Back returns to 开始 with it marked current again.

#### Scenario: a signed-out visit to a tool page

- Given a browser with no session
- When it opens `#/guide/tools/sonora?client=codex`
- Then it lands on `guide.html?chapter=tools&page=sonora&client=codex` showing the Sonora page.

### Requirement: Each chapter has an outline

Every chapter and tool page with two or more sections MUST show 本页大纲: a rail beside the text when the chapter is wide enough, otherwise a single button that unfolds the list. The outline MUST mark the section being read with `aria-current="location"` without writing the address on scroll, and choosing an entry MUST bring that section under both sticky bars and record it in the address without a new history entry.

#### Scenario: reading on a phone

- Given the 案例 chapter on a 390px-wide screen
- When the reader unfolds 本页大纲 and chooses Agent 回放
- Then the list was folded until asked for, and the replay section scrolls into view with its address updated.
