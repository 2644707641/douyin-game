FROM nginx:1.27-alpine

RUN rm /etc/nginx/conf.d/default.conf

COPY html/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && chown nginx /var/run/nginx.pid

USER nginx

EXPOSE 7860