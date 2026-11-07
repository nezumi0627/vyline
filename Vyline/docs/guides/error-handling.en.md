# Error Feedback and Recovery

Last updated: 2026-11-06

Failures from user-initiated actions should be reported near the action through the reserved-height `ActionFeedback` slot or an action-specific result. Explain what did not complete and the next safe step. A network interruption must not be described as a definite send failure when delivery is unknown.

## Display and logging boundaries

- Convert internal exceptions at API boundaries into stable error codes and user-facing guidance.
- Never include tokens, decryption keys, local paths, SQL, message content, or stack traces in API responses or UI.
- For diagnostics, log only explicitly safe codes and stages instead of raw exceptions that may contain private data.
- Background polling, optional caches, and parser fallbacks may remain quiet only when they are known fallbacks that do not block the user's action. Do not represent a persistent failure as success.
- Avoid repeatedly notifying the user about failures unrelated to an active action. Aggregate them in connection status or diagnostic logs where appropriate.

## Desktop history restore

History import from Settings > Advanced & Restore returns a `DESKTOP_RESTORE_*` code and a stage. This distinguishes process detection, key scan/matching, database integrity, account validation, and import without returning local database or process-memory contents.

The diagnostic events attached to GitHub issue #408 predate the reported restore attempt and contain no request to the desktop-history import API. They cannot establish the reported failure's cause. If the issue reproduces after updating, use the displayed code and stage to investigate it.

## UI implementation

Place `ActionFeedback` from `apps/desktop/src/components/action-feedback.tsx` near the action control. It reserves a minimum height while empty, announces updates through `aria-live`, and wraps long messages.

For new user actions, verify success, failure, and connection-loss outcomes. Document intentional quiet catches near their call sites. Do not mechanically turn every `catch` into a user notification.
