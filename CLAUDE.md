# CLAUDE.md

Static page that extracts fields from PDFs with AI running in the visitor's browser; public, no
login, nothing is uploaded. Workspace rules (branching, `DOCKER_CONTEXT`, security): `../CLAUDE.md`.
Engines, layout and deploy: `README.md`.

- No build step and no npm: the whole app is `site/index.html`, `style.css` and `app.js`.
- Run: `DOCKER_CONTEXT=desktop-linux docker compose up -d --build` (http://localhost:3004; needs
  local-infra's `localinfra_tunnel` network). Deploy: `./deploy.sh` (`--rollback`).
- Libraries are self-hosted under `site/vendor/` (git-ignored), downloaded by `scripts/vendor.sh` at
  a pinned version with a pinned SHA-512. To bump one, change version and checksum there and its
  path in `site/app.js` / `site/index.html`. Never load a script from a CDN.
- `security-headers.inc` holds the CSP (scripts from `'self'` only; `connect-src` limited to the
  model and language-data hosts). A new remote host needs a `connect-src` entry; don't loosen
  `script-src`.
