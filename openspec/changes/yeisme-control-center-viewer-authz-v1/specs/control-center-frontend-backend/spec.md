# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: Only admins run admin, owner and paid actions

The control center MUST refuse, with 403 `control_center_admin_required`, every action preview and confirm that is not a collaboration action unless the session's role is admin, and MUST re-check the role at confirm. Account actions (`admin.*`) MUST additionally require a personal session. Provider run submit and reconcile MUST require an admin before the request body or the run is read. Collaboration actions MUST keep their project grants.

#### Scenario: viewer tries an admin or paid action

- **WHEN** a viewer previews `admin.user.create`, `admin.user.revoke`, `provider_runs.create`, `task.cancel` or `project.metadata.*`, or posts to `/provider-runs` or a run's reconcile route
- **THEN** the response is 403 `control_center_admin_required` and nothing is created, revoked, submitted or changed

#### Scenario: role downgraded after a preview

- **WHEN** an admin previews an action and is downgraded to viewer before confirming
- **THEN** the confirm is refused with 403 `control_center_admin_required`
