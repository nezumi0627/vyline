[日本語](README.md)

<h1 align="center">Vyline</h1>

<p align="center">
  <strong>Vision Beyond Limits.</strong><br/>
  An unofficial LINE client for the web, Windows, macOS, and Linux.
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-1.0.3-a78bfa?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" />
</p>

> [!CAUTION]
> Vyline is an unofficial client and is not affiliated with LINE Corporation or LY Corporation. Understand the risks to your account and data, as well as LINE's terms, before using it. See [Privacy and Data](docs/user-guide/privacy-and-data.en.md).

> [!NOTE]
> **v1.0.3 is the current stable release and development baseline.** Docker images now build natively for amd64 and arm64, with stronger release validation and checksums for all downloadable archives. [Release](https://github.com/nezumi0627/vyline/releases/tag/v1.0.3) · [Changelog](CHANGELOG.md)

## About Vyline

Vyline is an open-source client for sending, receiving, and managing LINE chats. It combines a frontend, backend, and independently implemented protocol package, with local and self-hosted deployment options.

## Main features

- **Chats**: DMs and groups, messaging, read state, search, mentions, and URL previews
- **Media and rendering**: Images, video, audio, files, stickers, emoji, Flex/Rich messages, and reactions
- **Profiles and groups**: Profiles, friend and block management, group creation and settings
- **Personalisation**: NezuTheme, typography, notification and privacy settings, streamer mode
- **Data and support**: VylineBackup, Snapshots, history import, diagnostic logs, Agent I support
- **Operations and extensions**: Multiple accounts, subdevices, public API, CLI, and Docker self-hosting

See the [Feature Guide](docs/features.en.md) for descriptions and limitations and the [Capability Matrix](docs/feature-capabilities.md) for verification evidence. Implemented code and live LINE verification are tracked separately.

## Get started

- **Windows**: Download the [v1.0.3 Setup or portable build](https://github.com/nezumi0627/vyline/releases/tag/v1.0.3).
- **Linux**: The same release includes a Linux x64 build. Docker supports linux/amd64 and linux/arm64.
- **Web / self-hosting**: See the [Self-hosting Guide](docs/selfhosting.md).
- **macOS**: Download the `Vyline.app` ZIP for Apple Silicon (arm64) or Intel (x64) from Releases. See the [distribution guide](docs/distribution.md) for the first-launch Gatekeeper prompt for the unsigned app.
- **Updating**: [Update Guide](docs/user-guide/update.md).

## Before you use Vyline

Vyline is not an official LINE app. When using an external server, verify where credentials and chat history are stored. Some AI features send entered or explicitly selected content to Yahoo Agent I. Details and opt-out instructions are in [Privacy and Data](docs/user-guide/privacy-and-data.en.md).

## Documentation

| Topic | Document |
| --- | --- |
| Features | [Feature Guide](docs/features.en.md) |
| Setup and FAQ | [Getting Started](docs/start-here.md) |
| Windows, macOS, Linux, and Docker | [Distribution Guide](docs/distribution.md) |
| API | [OpenAPI and Public API](docs/api/openapi.md) |
| Contributions and maintainers | [Contribution Guide](docs/CONTRIBUTING.md) · [Maintainers](docs/maintainers.en.md) |
| Historical behavior such as v0.5.0 | [Release History](docs/history/releases.en.md) |
| All documentation | [Documentation Index](docs/README.md) |

## Contribute

Bug reports, feature proposals, and help with code, research, or translation are welcome. See the [Contribution Guide](docs/CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
