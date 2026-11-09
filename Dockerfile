# Static site served by unprivileged nginx on alpine-slim (smallest nginx image).
FROM nginxinc/nginx-unprivileged:alpine-slim
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html/
EXPOSE 3000
