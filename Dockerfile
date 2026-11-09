# Static site served by unprivileged nginx on alpine-slim (smallest nginx image), pinned version.

# Vendor stage: downloads the pinned, checksum-verified JS/wasm libraries into /out
# (the page loads no code from a CDN; see scripts/vendor.sh)
FROM alpine:3.22 AS vendor
RUN apk add --no-cache curl
COPY scripts/vendor.sh /vendor.sh
RUN sh /vendor.sh /out

FROM nginxinc/nginx-unprivileged:1.28.2-alpine-slim
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.inc /etc/nginx/snippets/security-headers.inc
COPY site/ /usr/share/nginx/html/
COPY --from=vendor /out /usr/share/nginx/html/vendor
EXPOSE 3000
