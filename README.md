# Project currently in development!!!
currently in alpha state

## Build & distribution

```bash
npm ci            # install build tooling (dev-only, never shipped)
npm run build     # validate sources and create dist/BetterZalo-v<version>.zip
```

The package version comes from `package.json` (single source of truth; bump it
with `npm version patch|minor|major`). The build stamps that version into the
packaged `betterzalo-core.js`, writes `manifest.json` (name, version,
`supportedZaloVersions`, file hashes) and `checksums.txt` (SHA-256), and zips
them as `manifest.json` + `files/` + `checksums.txt` for the BetterZalo-Patcher
to consume. Supported Zalo versions live in `scripts/build.mjs`
(`SUPPORTED_ZALO_VERSIONS`); only list versions actually verified.

To publish: create a GitHub Release (tag `v<version>`); the release workflow
attaches the ZIP automatically.
