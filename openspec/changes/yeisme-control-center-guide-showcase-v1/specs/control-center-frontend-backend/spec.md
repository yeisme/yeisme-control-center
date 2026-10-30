# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: The guide shows real recorded samples

The guide MUST show samples produced by real calls to the owner services. Every sample MUST state the prompt, the call that produced it, the model, the cost the owner reported, the time it took, the recording date and the service versions. A cost the owner did not report MUST be shown as unreported, never estimated. Every sample MUST be labelled as AI generated.

Shipped sample files MUST carry no embedded metadata, internal address, key or full run identifier. They MUST be listed in a manifest with no unlisted file, and MUST total at most 8 MB.

#### Scenario: reading how a video sample was made

- Given the public guide
- When a visitor opens the generation record of the text-to-video sample
- Then it shows the Scaena call with model, duration, resolution and ratio, the cost as unreported with the request cap, the time and the date.

### Requirement: The guide replays recorded agent sessions

The guide MUST replay real Claude Code and Codex sessions. Each step MUST keep the actual user request, agent reply, or tool call with its action and arguments. Folded runs of similar calls MUST state how many calls they replace. An editor's note MUST correct any explanation of the agent's that the run record contradicts.

The replay MUST reveal one step at a time and move focus to each new step. It MUST follow the page's client choice. It MUST end with the result and with both the provider spend and the agent's own usage.

#### Scenario: the agent stops before spending

- Given the Claude Code replay
- When it first appears
- Then it shows the request, the discovery calls, the dry run and the agent asking for confirmation, and nothing after that until the visitor asks for the next step.

### Requirement: The guide documents each tool end to end

The guide MUST give each tool a manual covering installation, initialisation and credentials, generation, cost and confirmation, output and read-back, and links to its real samples. It MUST give Claude Code and Codex configuration in which a shared service's token appears only as an environment-variable name. It MUST give a troubleshooting table that marks the problems actually met while recording.

#### Scenario: connecting a shared service

- Given the configuration examples
- When a visitor copies the Claude Code shared-service command
- Then the resulting `.mcp.json` names `${EIKONA_MCP_TOKEN}` and contains no token.

### Requirement: Guide media works from the keyboard

The sample viewer MUST open from the keyboard, step with the arrow keys, close on Escape and return focus to the thumbnail that opened it. The before-and-after slider MUST move with the arrow keys. Video and audio MUST use native controls and load by byte range. With reduced motion, the guide MUST NOT animate the viewer or the replay steps.

#### Scenario: comparing an edit without a mouse

- Given the edit sample
- When a visitor focuses the slider and presses the right arrow five times
- Then the split moves from 50% to 55%.
