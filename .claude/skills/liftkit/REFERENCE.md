# LiftKit Reference

## Links

- Repo: https://github.com/Chainlift/liftkit
- Site: https://www.chainlift.io/liftkit
- Template: https://github.com/Chainlift/liftkit-template
- Tailwind community fork: https://github.com/jellydeck/liftkit-tailwind
- Overview (JP): https://gigazine.net/news/20260212-liftkit-ui/

## FAQ (Upstream)

- Installing one component may install several (shared dependencies).
- Extra CSS may appear; unused styles are removed at build time.
- Tailwind runtime is **not** required; only a config file may be needed for the registry.

## Figma / Webflow

- Figma community file exists but upstream warns quality is poor.
- Webflow template is linked from the README.

## Rewrite Status

As of early 2026, Chainlift is rewriting components around Base UI primitives (~50% complete per README). Prefer design formulas over depending on unstable component APIs for long-lived production apps unless the user accepts that risk.
