# Included in every location that sets its own add_header (nginx drops inherited add_header
# directives as soon as a location defines one), so each response carries the same headers.

# Enable SharedArrayBuffer for multi-threaded WASM
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "credentialless" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

# The page handles personal documents, so only our own code may run (all libraries are self-hosted
# under /vendor, see scripts/vendor.sh). 'wasm-unsafe-eval' = WebAssembly (pdf.js, tesseract, onnx,
# wllama), no JS eval. Workers: same-origin scripts plus blob: (wllama builds its workers from blobs).
# connect-src = the data hosts: Hugging Face (model weights; its downloads redirect to *.hf.co) and
# jsDelivr (Tesseract language data); blob: for page images handed to the OCR/vision models.
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: data: https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net; img-src 'self' blob: data:; style-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" always;
