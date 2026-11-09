# doc-extractor

<img src="docs/icon.png" alt="doc-extractor icon" width="96" align="right">

Static web page that extracts structured information (type, title, author, date, summary, or any
fields you define) from PDF documents, using AI that runs **in the browser**. Nothing is uploaded to
a server: the PDF is read and analysed on the user's machine.

![doc-extractor](docs/screenshot.png)

## Engines

The page detects which engines the browser can run and lets you pick one:

| Engine | Needs |
|---|---|
| Gemini Nano (multimodal / text) | Chrome 128+ with the Prompt API flags (the page explains how) |
| Florence-2 + wllama | ~570 MB model download, on-device vision OCR |
| Tesseract.js + wllama | ~370 MB model download, traditional OCR |

Libraries and models (pdf.js, tesseract.js, transformers.js, wllama, Hugging Face models) are loaded
from CDNs at runtime, so the browser needs internet access.

## Layout

```
site/             index.html, style.css, app.js (the whole app), favicon.svg
docs/             screenshot.png, icon.png (512 px render of site/favicon.svg)
nginx.conf        serves site/ on :3000, adds COOP/COEP headers (required for multi-threaded WASM), /health
Dockerfile        nginxinc/nginx-unprivileged:alpine-slim (~19 MB image)
docker-compose.yml, deploy.sh   deploy to the Raspberry Pi (see below)
```

## Run locally

```bash
DOCKER_CONTEXT=desktop-linux docker compose up -d --build   # http://localhost:3004
```

`docker-compose.yml` joins the external network `localinfra_tunnel`, so local-infra must be running on
Docker Desktop (or run the image directly: `docker run --rm -p 3004:3000 $(docker build -q .)`).
`.env` (git-ignored) only holds `PORT=3004`.

## Deploy (Raspberry Pi)

Same flow as the other apps (`local-infra/DEPLOYING-APPS.md`): from the Mac, through the `umbrel`
Docker context; the image is built on the Mac (linux/arm64) and loaded into the Pi.

```bash
./deploy.sh              # build, send, restart, wait for healthy
./deploy.sh --rollback   # back to the previous image
```

### Public access (Cloudflare tunnel)

Cloudflare Zero Trust → Networks → Tunnels → `localinfra-tunnel` → *Published application routes* →
add a route: your hostname, service type `HTTP`, URL `doc-extractor:3000`.

The container already joins `localinfra_tunnel`, so no other change is needed. The page is public
and has no login; anything it does happens in the visitor's browser.
