# Vyline Feature Guide

Last updated: 2026-11-03

This guide brings together the user-facing feature summaries for stable **1.1.0**. See [Getting Started](./start-here.md) for installation. Implementation and live verification against LINE are different things; see the [Capability Matrix](./feature-capabilities.md) for evidence and limitations.

## Accounts and devices

- QR and email login, restoring saved sessions, and switching between multiple accounts.
- Viewing and editing profiles, searching for friends, checking block status, and managing contacts.
- Pairing and using subdevices.
- Reauthentication may be needed if credentials expire, device authorization is revoked, or LINE changes its behavior.

## Chats and messages

- DM and group lists; sending, receiving, replying to, editing, unsending, and retrying messages.
- Read and unread state, group reader information, and reactions.
- Letter Sealing decryption and sending, including keys imported from LINE Desktop. Store keys as secrets.
- In-chat search, regular expressions, Ctrl+F, URL recognition, copying, and previews.
- Named mentions, group invitations, group creation, and group settings.
- Calls are experimental and may depend on LINE-side availability and device limitations.
- OpenChat / Square is a separately consented Beta. No Square requests are sent before it is enabled. See [OpenChat / Square Beta](./openchat-square.en.md) for current support and unsupported threads, notes, roles, and other features.

## Media and appearance

- Sending and displaying images, video, audio, files, stickers, and LINE emoji.
- Flex, carousel, and Rich content rendering.
- VyTheme, font size, display density, and profile backgrounds.
- Image compression and high-quality sending, media auto-save, and preview behavior can be managed in settings.

## Privacy and support

- Per-item streamer-mode masking, PIN lock, and browser notification settings.
- Beta includes features such as block-status checks that require separate consent.
- Agent I writing assistance and other AI options can be enabled or disabled according to the terms and individual settings. Some features send input to Yahoo Agent I.
- Diagnostic data can be reviewed before sharing. Do not publish logs containing secrets.

## Backup and operations

- Back up and restore chat history and media with VylineBackup.
- Create, list, and restore Snapshots; import chat history from iOS backups.
- Setup, diagnostics, and repair with the CLI.
- Docker self-hosting, browser access, and a Bearer-token public API.
- Standalone Windows and Linux distributions and macOS app ZIPs for Apple Silicon and Intel are available. The macOS app is not signed or notarized, so Gatekeeper confirmation is required on first launch.

## Data and extension guides

| Goal | Feature | Guide |
| --- | --- | --- |
| Save and restore chats and saved media | VylineBackup, with per-chat and text-only restore options | [Backup and restore](../Vyline/docs/guides/vyline-backup-restore.md) |
| Move settings to another environment | Settings handoff ZIP, excluding authentication tokens and E2EE keys | [Settings handoff](./setup-account-handoff-debug.md) |
| Import local iPhone history | Encrypted iOS backup import, subject to documented limitations | [iOS backup import](../Vyline/docs/guides/ios-backup-restore.md) |
| Update the application | Update notices and release downloads | [Update guide](./user-guide/update.md) |

For appearance, see [VyTheme](./user-guide/themes.md). For developer extensions and permissions, see [Plugins](./developers/plugin-system.md). The unpublished plugin UI was removed in 1.0.2; this is a developer reference, not a promise of an available in-app plugin catalogue.
For integrations and hosting, see [Public API](./api/openapi.md), [Docker installation](./install/docker.md), and [Self-hosting](./selfhosting.md).
See [Subdevices](./subdevices.md) for pairing another device.

## Verification

LINE-connected features may have implementation code without having been verified against a live account. Check the [Capability Matrix](./feature-capabilities.md) for feature-specific evidence and known limits.
