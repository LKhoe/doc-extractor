#!/bin/sh
# Downloads the JavaScript/wasm libraries the page runs into site/vendor/<lib>@<version>/ so the
# page loads no code from a CDN (it handles people's documents). Every tarball comes from the npm
# registry at an exact version and is verified against a pinned SHA-512 before it is unpacked.
# Run by the Dockerfile (vendor stage); run it by hand for local work outside Docker.
# To bump a library: change VERSION and SHA512 (npm view <pkg>@<ver> dist.integrity, base64 -> hex),
# and the matching path in site/app.js / site/index.html.
set -eu

OUT="${1:-$(dirname "$0")/../site/vendor}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

sha512_of() { if command -v sha512sum >/dev/null 2>&1; then sha512sum "$1" | cut -d' ' -f1; else shasum -a 512 "$1" | cut -d' ' -f1; fi; }

# fetch <registry path> <tarball name> <sha512 hex> <dest dir name>: leaves the unpacked package/ in $TMP/<dest>
fetch() {
  url="https://registry.npmjs.org/$1/-/$2.tgz"
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$url" -o "$TMP/$4.tgz"; else wget -q -O "$TMP/$4.tgz" "$url"; fi
  got="$(sha512_of "$TMP/$4.tgz")"
  [ "$got" = "$3" ] || { echo "checksum mismatch for $1 ($2): got $got" >&2; exit 1; }
  mkdir -p "$TMP/$4" && tar xzf "$TMP/$4.tgz" -C "$TMP/$4"
}

put() { # put <src> <dest dir>
  mkdir -p "$2" && cp "$1" "$2/"
}

rm -rf "$OUT" && mkdir -p "$OUT"

# pdf.js
V=4.8.69
fetch pdfjs-dist "pdfjs-dist-$V" 20766c0384fb60494228d357b622e0a92730e333ddde91bd768f14af39c2ef9ee031ded43de1d22f6ab034d309a38afbf5f97ca23d57c7ed67876624cdd3292d pdfjs
for f in pdf.min.mjs pdf.worker.min.mjs; do put "$TMP/pdfjs/package/build/$f" "$OUT/pdfjs-dist@$V"; done
put "$TMP/pdfjs/package/LICENSE" "$OUT/pdfjs-dist@$V"

# tesseract.js (main script + worker) and tesseract.js-core (the wasm; only the two LSTM builds the
# default engine mode loads: SIMD and non-SIMD)
V=5.1.1
fetch tesseract.js "tesseract.js-$V" 973565fc0af73f7ce1a544f7d4d8ea782a357fe0f9f987e967927ad9ea364b5e103553a61c14ed6dc8479bf6006ce38ecc27a016729fe01dd08a1f4bba575c61 tess
for f in tesseract.min.js worker.min.js; do put "$TMP/tess/package/dist/$f" "$OUT/tesseract.js@$V"; done
put "$TMP/tess/package/LICENSE.md" "$OUT/tesseract.js@$V"
V=5.1.1
fetch tesseract.js-core "tesseract.js-core-$V" 297ddb61253988670ed5725af9018f6e2f998e8daaaba78184d8d2191e44e6ad09b739288a924a394403ee987c905cad78211f110d266962eef0c097b6f5f9b9 tesscore
for f in tesseract-core-lstm.wasm.js tesseract-core-simd-lstm.wasm.js LICENSE; do put "$TMP/tesscore/package/$f" "$OUT/tesseract.js-core@$V"; done

# transformers.js (browser bundle) and the onnxruntime-web wasm it ships in dist/
V=3.8.1
fetch @huggingface/transformers "transformers-$V" b6c4e4e33563226a9daa34bcfc0399836c8d2ddd73f52e6ffbba143e95da6ac0d1c040e107ec678252b593971a776ea52f9fd921a791120596cb46ecf72f693c tf
for f in transformers.web.min.js ort-wasm-simd-threaded.jsep.mjs ort-wasm-simd-threaded.jsep.wasm; do put "$TMP/tf/package/dist/$f" "$OUT/transformers@$V"; done
put "$TMP/tf/package/LICENSE" "$OUT/transformers@$V"

# wllama
V=2.3.7
fetch @wllama/wllama "wllama-$V" 4f6ef780112a119087028c8d64383e5fa6e841692d6aaf9e7cd17a6c9a396874e826bee34b590260898a5c37418b6fc271c46e05470c0471cb1e240de3e39f29 wllama
put "$TMP/wllama/package/esm/index.js" "$OUT/wllama@$V"
put "$TMP/wllama/package/esm/single-thread/wllama.wasm" "$OUT/wllama@$V/single-thread"
put "$TMP/wllama/package/esm/multi-thread/wllama.wasm" "$OUT/wllama@$V/multi-thread"

echo "vendored into $OUT"
