# Vyline documentation tour

## Intent

Rebuild the GitHub Pages documentation without opening or reading the old website or its rendering source. The user requests an expressive guided installation and product tour, a consolidated documentation library, and clearer Japanese and English repository READMEs advertising stable 1.0.3.

## Design

- Product: an unofficial LINE client with local and self-hosted use, personalisation, messaging and data controls.
- Character: nocturnal, precise, inquisitive. The user explicitly chose cosmic black and white instead of a bright palette.
- World: orbital navigation. Near-black #08090a, white #f5f5f5, readable secondary #a8aaae. Accent is white; no colored gradients, glows, scattered star fields or decorative looping motion.
- Moments: a hand-built message route shows LINE conversations passing through Vyline into a chosen environment. The installation route shows the selected OS command beside its next action, then continues through QR login and personalization; Docs starts with task choices and offers search only when someone knows what they need.
- Signature: one continuous signal line joins the conversation, Vyline and the available environments. Buttons use a precise light-on-dark hierarchy, with distinct hover, pressed, focus and selected states.
- Type: system sans with Japanese fallbacks and system mono for coordinates and commands. The top route fits one viewport; longer tour and article screens earn their scroll space.

Unslop by Damir Sokolovsky: https://github.com/heydamir/unslop/tree/main/skills/unslop (CC BY 4.0). Applied principles: quiet chrome, deliberate spacing, product-specific moments, no fake metrics, no gradient typography or redundant feature cards. Existing-site visual audit intentionally omitted at the user's request. Black/white, orbit geometry, and varied control shapes are deliberate user-requested exceptions to generic anti-slop prescriptions.

## Architecture and content

Buildless HTML/CSS/JS in `Vyline/website/`. Bun build entry `scripts/build-landing.ts` replaces the former entry without reading it. Build documents from repository Markdown using Bun.markdown and rewrite local document links; ship a searchable curated library and readable article pages. Preserve source Markdown links in README. No backend, tracking, actual LINE connection or outgoing messages.

The installation tour has OS selection, download/setup, QR login instructions and a step into task-guided Docs. No simulated messaging or unconnected settings demo is shown. URL parameters preserve a shareable OS/step, step navigation remains reversible, and reduced motion is respected. Windows and Linux links target the verified v1.0.3 assets. macOS has no native installer and uses source/browser instructions. Docker documents use actual Compose port 3000.

Consolidate overlapping feature summaries into the feature guide, with explicit links to capability evidence, privacy, themes, plugins, data recovery and operations. Do not relabel partial features as verified. Keep architecture/analysis/history documents; update entry points and stale current-version claims only. README source pairs remain symmetric and are generated with the existing generator. Preserve logo CC BY attribution.

## Acceptance

1. Old rendering source replaced; no old website viewed. Pages workflow watches website, docs, logo and README inputs.
2. Responsive black/white interface with a one-screen home, OS-specific install tour, task-based Docs search, article navigation, mobile menu and reduced-motion behavior; no mock chat demo.
3. Stable 1.0.3 links and accurate Windows/Linux/macOS/Docker Markdown guides, consolidated features, Japanese/English README sources and generated outputs.
4. Build tests validate deterministic output, base-path links, missing documents, safe output directory handling and no broken local links. Browser checks cover desktop/mobile, keyboard, OS branches, search and interactions.
5. Reviewable branch/PR, no main merge or live publication without approval. Preserve the worktree until changes are saved and merged; remove the task-created worktree after merge.

## User-directed refinement

After seeing the first implementation, the user asked for a new information architecture, rejected a mock chat demo and a long undifferentiated document list, and approved the deep article-page format as a separate Docs layer. Later feedback rejected the stock lunar photo and the installation screen's generic wizard treatment. The home now uses a product-specific message route and one direct installation action. The tour keeps the selected environment visible beside its installation steps, followed by login and personalization. Articles keep the approved sidebar, contents, breadcrumb and next-article reading layout. The intro ends by linking into Docs. These choices supersede the earlier photo, wizard and demo descriptions above.
