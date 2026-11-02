# vyl

Short package name for the Vyline CLI.

## Usage

```bash
bunx vyl init
bunx vyl install
bunx vyl doctor
```

`vyl install` requires Git and a new destination directory; it clones required submodules. Snapshots include account data only and exclude saved media in the storage directory.

This package forwards to `@vyline/cli`. If the short `vyl` package name cannot be published or installed in your environment, use the scoped package directly:

```bash
bunx @vyline/cli init
```
