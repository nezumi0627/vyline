# Release History and Baseline

Last updated: 2026-11-03

The current stable baseline is **v1.0.2**. Future fixes and features are developed on main from this stable release. Published tags are not overwritten; new releases use new version numbers.

## v1.0.2 — Settings and diagnostics fixes

Fixed diagnostic logging enablement and stale status during account switching. Beta features and settings categories were reorganized, and the unreleased plugin entry points were removed from the app. See the [changelog](../../CHANGELOG.md) and [GitHub Release](https://github.com/nezumi0627/vyline/releases/tag/v1.0.2).

## v1.0.1 — Windows distribution startup fix

Fixed a silent exit in the v1.0.0 Windows Setup: the packaged backend could not resolve the pino-pretty transport. Startup logs are now preserved, and the required protocol fallback profile is included in the distribution. See the [changelog](../../CHANGELOG.md) and [GitHub Release](https://github.com/nezumi0627/vyline/releases/tag/v1.0.1).

## v1.0.0 — Stable release

Consolidated functionality and quality improvements since v0.8.0-beta and established a stable baseline. Major areas included message and read-state persistence, search and rendering, settings and backups, profile and group management, support, and distribution.

## v0.5.0-beta — Sync and public API transition

v0.5.0-beta was a breaking migration from v0.4.x. Current users generally do not need this historical information. See the [legacy migration note](./v0.5.0.en.md).

## Full changelog

See the [changelog](../../CHANGELOG.md) for version-by-version additions, changes, and fixes.
