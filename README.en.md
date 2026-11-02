<!-- GENERATED FILE. Edit README.en.src.md, then run bun run docs:readme. -->
<!-- Language: en -->

[日本語](README.md)

<h1 align="center">Vyline</h1>

<p align="center"><img src="logo/assets/color/128.png" alt="Vyline logo" width="72" height="72" /></p>

<p align="center">
  <strong>Vision Beyond Limits.</strong><br/>
  An unofficial LINE client for the web, Windows, and Linux.
</p>

<p align="center">
  <a href="https://github.com/nezumi0627/vyline/releases/tag/v1.0.3"><img alt="Stable 1.0.3" src="https://img.shields.io/badge/version-1.0.3-eeeeee?style=flat-square&amp;labelColor=181818" /></a>
  <img alt="license MIT" src="https://img.shields.io/badge/license-MIT-eeeeee?style=flat-square&amp;labelColor=181818" />
</p>

<p align="center"><a href="https://nezumi0627.github.io/Vyline/#start">Installation tour</a> · <a href="docs/features.en.md">Explore features</a> · <a href="https://nezumi0627.github.io/Vyline/#docs">Find documentation by task</a></p>

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
- **Personalisation**: VyTheme, typography, notification and privacy settings, streamer mode
- **Data and support**: VylineBackup, Snapshots, history import, diagnostic logs, Agent I support
- **Operations and extensions**: Multiple accounts, subdevices, public API, CLI, and Docker self-hosting

See the [Feature Guide](docs/features.en.md) for descriptions and limitations and the [Capability Matrix](docs/feature-capabilities.md) for verification evidence. Implemented code and live LINE verification are tracked separately.

## Get started

**The stable release is 1.0.3.** Choose the instructions for your environment.

| Environment | Download or method | Installation guide |
| --- | --- | --- |
| Windows x64 | [Setup.exe](https://github.com/nezumi0627/vyline/releases/download/v1.0.3/VylineSetup-1.0.3.exe) / [Portable ZIP](https://github.com/nezumi0627/vyline/releases/download/v1.0.3/Vyline-portable-1.0.3.zip). No Bun installation required | [Windows](docs/install/windows.md) |
| Linux x64 | [tar.gz](https://github.com/nezumi0627/vyline/releases/download/v1.0.3/Vyline-linux-x64-1.0.3.tar.gz). No Bun installation required | [Linux](docs/install/linux.md) |
| macOS | Run from source or use a browser. No dedicated installer | [macOS](docs/install/macos.md) |
| Docker / Web | Run on an amd64 or arm64 server | [Docker](docs/install/docker.md) |

Continue with [Login and initial setup](docs/start-here.md#ログインと初回設定). Read the [Update Guide](docs/user-guide/update.md) before updating.
Verify downloads against [SHA256SUMS.txt](https://github.com/nezumi0627/vyline/releases/download/v1.0.3/SHA256SUMS.txt).

## Before you use Vyline

Vyline is not an official LINE app. When using an external server, verify where credentials and chat history are stored. Some AI features send entered or explicitly selected content to Yahoo Agent I. Details and opt-out instructions are in [Privacy and Data](docs/user-guide/privacy-and-data.en.md).

## Documentation

| Topic | Document |
| --- | --- |
| Features | [Feature Guide](docs/features.en.md) |
| Setup and FAQ | [Getting Started](docs/start-here.md) |
| Windows, Linux, and Docker | [Distribution Guide](docs/distribution.md) |
| API | [OpenAPI and Public API](docs/api/openapi.md) |
| Contributions and maintainers | [Contribution Guide](docs/CONTRIBUTING.md) · [Maintainers](docs/maintainers.en.md) |
| Historical behavior such as v0.5.0 | [Release History](docs/history/releases.en.md) |
| All documentation | [Documentation Index](docs/README.md) |

## Contribute

Bug reports, feature proposals, and help with code, research, or translation are welcome. See the [Contribution Guide](docs/CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).

The logo has a separate license: Copyright © 2026 y2mc / Project Vyline, [CC BY 4.0](logo/LICENCE).
