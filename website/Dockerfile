FROM nginxinc/nginx-unprivileged:stable-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html styles.css script.js robots.txt sitemap.xml /usr/share/nginx/html/
COPY assets/ /usr/share/nginx/html/assets/

EXPOSE 8080
