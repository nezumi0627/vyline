# UI/UX Design Task Template

Use this when planning UI work or splitting it across agents.

## Subagent Split

### Agent 1: Information Architecture

Scope:
- Product type and user goals.
- Screen map and navigation.
- What belongs on Home/Overview versus dedicated screens.
- Layout model: sidebar, workbench, inspector, logs, dialogs.

Return:
- Screen responsibilities.
- User flows.
- Navigation rules.
- Data dependencies.
- Implementation tasks and acceptance criteria.

### Agent 2: Workflow and Usability

Scope:
- Main user workflows.
- Inputs, validation, disabled states, recovery.
- Async jobs, progress, cancellation, history, notifications.
- Edge cases and failure states.

Return:
- State machine.
- Edge-case matrix.
- Notification rules.
- Usability risks.
- Implementation tasks and acceptance criteria.

### Agent 3: Visual System and Accessibility

Scope:
- Design tokens.
- Component rules.
- Typography, spacing, color, borders, density.
- Motion and accessibility.

Return:
- Token proposal.
- Component-by-component rules.
- Motion rules.
- A11y checklist.
- Implementation tasks and acceptance criteria.

### Agent 4: Implementation Plan

Scope:
- Repository structure.
- Framework choice.
- API client and state model.
- Tests/build verification.

Return:
- File plan.
- Milestones.
- Risk list.
- Verification commands.

## Consolidated Output

```markdown
# UI/UX Redesign Plan

## Design Thesis

[One paragraph describing the product experience and what the UI must optimize for.]

## Information Architecture

- [Screen]: [Responsibility]

## Core Workflows

- [Workflow]: [Steps and expected feedback]

## Visual System

- Color:
- Typography:
- Spacing:
- Components:
- Motion:

## State Matrix

| State | User sees | User can do | Recovery |
| --- | --- | --- | --- |
| idle | | | |
| loading | | | |
| running | | | |
| success | | | |
| failed | | | |
| cancelled | | | |

## Implementation Tasks

### UI-01: [Task]

Acceptance:
- [Condition]

## Verification

- [Command or manual check]
```
