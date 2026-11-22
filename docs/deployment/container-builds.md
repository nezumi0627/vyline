# Container CI

`.github/workflows/container.yml` builds `linux/amd64` on `ubuntu-24.04` and
`linux/arm64` on `ubuntu-24.04-arm` in parallel. Both run the existing Dockerfile
on native CPUs, including Bun and Compose/Wasm compilation, without QEMU.
GitHub documents both [runner architectures](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
and Bun's [Docker image supports x64 and arm64](https://bun.sh/docs/installation).

Each build pushes an immutable digest with provenance and an SBOM. Only after
both builds succeed does `publish` merge the digests and update the existing
`latest`, branch, tag and SHA tags. The final manifest is checked for both Linux
architectures. This uses Docker's [manifest merge](https://docs.docker.com/reference/cli/docker/buildx/imagetools/create/)
and [distributed build](https://docs.docker.com/build/ci/github-actions/multi-platform/)
mechanisms; no architecture-specific mutable tags are published.

BuildKit caches use `container-amd64` and `container-arm64` scopes so the builds
do not overwrite each other's architecture cache. The existing amd64 CI startup
smoke test and Trivy image scan reuse the amd64 scope with `load: true`.
Pull requests retain their existing checks and do not publish images. GitHub's
[branch cache restrictions](https://docs.docker.com/build/cache/backends/gha/)
still apply.

The native build matrix and cache scopes are validated by the required GitHub
Actions checks. Local Docker/Podman is not required for this workflow change.
Docker/Podman is unavailable on the Windows development host, so native Linux
builds, GHCR manifest/attestation publication, and build-time improvements must
be verified in the next authorized Actions run. No CI timing reduction has
been measured locally.
