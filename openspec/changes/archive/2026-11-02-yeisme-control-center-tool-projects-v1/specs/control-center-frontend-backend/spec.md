# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: Every readable tool project can be bound, several per tool

The system MUST offer as binding options every tool project a source scope of the organization's tenant reads: the scope's default project for each tool, and the project of each of its connections. A shared project MUST be able to bind up to ten tool projects, several of the same tool. It MUST NOT bind the same project twice. The server MUST rebuild each binding's connection ids from its own view, and project-wide delegated reads MUST only reach projects the shared project binds.

#### Scenario: binding two projects of one tool

- Given a scope reads Eikona projects A (default), B and C
- When an administrator creates a shared project bound to B and C
- Then the shared project reads tasks of B and C, and no delegated read reaches A.

#### Scenario: generation needs a target project

- Given a shared project binds two Eikona projects
- When a creator prepares a generation item without naming one of them
- Then the server rejects it with `generation_target_project_required`; naming one routes every owner call of that item to it.

### Requirement: An administrator connects a tool project by reference

The system MUST let an administrator, in a personal session, connect another project of a tool by entering its reference, reusing an enabled connection configured for the same scope. Before saving, the server MUST ask the owner once through a throwaway connection. A refusal MUST be reported without blocking the configured connection. A connected project MUST be readable without a restart and MUST NOT be able to cancel tasks. Only connected projects MAY be disconnected.

#### Scenario: the owner refuses the project

- Given the configured credential does not cover project P
- When the administrator tries to connect P
- Then the preview fails with `owner_project_not_accessible` and the configured connection keeps reading.

#### Scenario: the owner accepts the project

- Given the configured credential covers project Q
- When the administrator connects Q
- Then Q appears among the tool projects and binding options at once, and its tasks are read on the next refresh.

### Requirement: One place for shared projects and tool projects

The system MUST present shared projects and tool projects as two tabs of the projects page. It MUST group tool projects by tool and show which ones are the default, which were connected here, and how many shared projects use each. Each tool project's menu, and its context menu, MUST offer creating a shared project from it and adding it to an existing shared project.

#### Scenario: starting a shared project from a tool project

- Given a tool project in the tool-projects tab
- When the user chooses "用它新建共享项目"
- Then the shared-project form opens with that tool project already selected.
