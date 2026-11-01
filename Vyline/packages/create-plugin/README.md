# create-vyline-plugin

Create a minimal Vyline plugin scaffold.

## Usage

```bash
bunx create-vyline-plugin my-plugin
```

Inside a Vyline repository checkout, prefer:

```bash
bun run vyl plugin create my-plugin
```

The generated template is intentionally small: manifest, TypeScript entrypoint, package metadata, and a README. Add permissions and runtime APIs only when the plugin actually needs them.
