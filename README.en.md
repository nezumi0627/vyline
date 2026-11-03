<!-- GENERATED FILE. Edit README.en.src.md, then run bun run docs:readme. -->
<!-- Language: en -->

[日本語](README.md)

<p align="center">
  <img src="logo/assets/color/128.png" alt="Vyline logo" width="88" height="88" />
</p>

<h1 align="center">Vyline</h1>

<p align="center">
  <strong>Vision Beyond Limits.</strong><br/>
  An unofficial LINE client for the web, Windows, macOS, and Linux.
</p>

<p align="center">
  <a href="https://github.com/nezumi0627/vyline/releases/tag/v1.1.0"><img alt="Stable 1.1.0" src="https://img.shields.io/badge/version-1.1.0-eeeeee?style=flat-square&amp;labelColor=181818" /></a>
  <img alt="license MIT" src="https://img.shields.io/badge/license-MIT-eeeeee?style=flat-square&amp;labelColor=181818" />
  <a href="https://技術者倫理.com"><img alt="技術者倫理 遵守済み" src="https://img.shields.io/badge/%E6%8A%80%E8%A1%93%E8%80%85%E5%80%AB%E7%90%86-%E9%81%B5%E5%AE%88%E6%B8%88%E3%81%BF-0a0a0a?style=for-the-badge&amp;labelColor=ffffff" /></a>
  <img alt="runtime Bun" src="https://img.shields.io/badge/runtime-Bun-000000?style=flat-square" />
  <img alt="frontend React" src="https://img.shields.io/badge/frontend-React-61DAFB?style=flat-square" />
  <img alt="backend Hono" src="https://img.shields.io/badge/backend-Hono-E36002?style=flat-square" />
  <img alt="language TypeScript" src="https://img.shields.io/badge/language-TypeScript-3178C6?style=flat-square" />
  <img alt="build Vite" src="https://img.shields.io/badge/build-Vite-646CFF?style=flat-square" />
  <img alt="database SQLite" src="https://img.shields.io/badge/database-SQLite-003B57?style=flat-square" />
</p>

<p align="center"><a href="https://nezumi0627.github.io/vyline/#start">Installation tour</a> · <a href="docs/features.en.md">Explore features</a> · <a href="https://nezumi0627.github.io/vyline/#docs">Find documentation by task</a> · <a href="links/">Related repositories</a></p>

> [!CAUTION]
> Vyline is an unofficial client and is not affiliated with LINE Corporation or LY Corporation. Understand the risks to your account and data, as well as LINE's terms, before using it. See [Privacy and Data](docs/user-guide/privacy-and-data.en.md).

> [!NOTE]
> **v1.1.0 is the current stable release and development baseline.** Adds local macOS distribution, in-app update guidance, multilingual UI settings, and Desktop history restoration, and fixes Linux package startup. [Release](https://github.com/nezumi0627/vyline/releases/tag/v1.1.0) · [Changelog](CHANGELOG.md)

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

**The stable release is 1.1.0.** Choose the instructions for your environment.

| Environment | Download or method | Installation guide |
| --- | --- | --- |
| Windows x64 | [Setup.exe](https://github.com/nezumi0627/vyline/releases/download/v1.1.0/VylineSetup-1.1.0.exe) / [Portable ZIP](https://github.com/nezumi0627/vyline/releases/download/v1.1.0/Vyline-portable-1.1.0.zip). No Bun installation required | [Windows](docs/install/windows.md) |
| Linux x64 | [tar.gz](https://github.com/nezumi0627/vyline/releases/download/v1.1.0/Vyline-linux-x64-1.1.0.tar.gz). No Bun installation required | [Linux](docs/install/linux.md) |
| macOS | [Apple Silicon ZIP](https://github.com/nezumi0627/vyline/releases/download/v1.1.0/Vyline-macos-arm64-1.1.0.zip) / [Intel ZIP](https://github.com/nezumi0627/vyline/releases/download/v1.1.0/Vyline-macos-x64-1.1.0.zip) | [macOS](docs/install/macos.md) |
| Docker / Web | Run on an amd64 or arm64 server | [Docker](docs/install/docker.md) |

For a command-first setup, the **Bun + vyl CLI** works the same on Windows, macOS, and Linux. [Register and start vyl](docs/install/cli.md)

Continue with [Login and initial setup](docs/start-here.md#ログインと初回設定). Read the [Update Guide](docs/user-guide/update.md) before updating.
Verify downloads against [SHA256SUMS.txt](https://github.com/nezumi0627/vyline/releases/download/v1.1.0/SHA256SUMS.txt).

## Before you use Vyline

Vyline is not an official LINE app. When using an external server, verify where credentials and chat history are stored. Some AI features send entered or explicitly selected content to Yahoo Agent I. Details and opt-out instructions are in [Privacy and Data](docs/user-guide/privacy-and-data.en.md).

## Documentation

| Topic | Document |
| --- | --- |
| Features | [Feature Guide](docs/features.en.md) |
| Setup and FAQ | [Getting Started](docs/start-here.md) |
| Windows, macOS, Linux, and Docker | [Distribution Guide](docs/distribution.md) |
| Register and launch with Bun and vyl | [CLI installation guide](docs/install/cli.md) |
| API | [OpenAPI and Public API](docs/api/openapi.md) |
| Contributions and maintainers | [Contribution Guide](docs/CONTRIBUTING.md) · [Maintainers](docs/maintainers.en.md) |
| Historical behavior such as v0.5.0 | [Release History](docs/history/releases.en.md) |
| All documentation | [Documentation Index](docs/README.md) |

## Contribute

Bug reports, feature proposals, and help with code, research, or translation are welcome. See the [Contribution Guide](docs/CONTRIBUTING.md).

## Acknowledgements

Thank you to [@yuz-mc](https://github.com/yuz-mc) for creating Vyline's logo and app icon ([PR #294](https://github.com/nezumi0627/vyline/pull/294)). The logo assets are licensed under CC BY 4.0. App-size PNGs, the Windows ICO, and macOS ICNS are derived formats generated from the original logo. See [`logo/LICENCE`](logo/LICENCE) for the attribution and license terms.

## License

The software is MIT licensed ([LICENSE](LICENSE)); logo and icon assets are separately licensed under CC BY 4.0 ([`logo/LICENCE`](logo/LICENCE)).
