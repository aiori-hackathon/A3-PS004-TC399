FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    unbound dnsutils ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY unbound.conf /etc/unbound/unbound.conf
COPY start-unbound.sh /usr/local/bin/start-unbound.sh
RUN chmod +x /usr/local/bin/start-unbound.sh && mkdir -p /run/unbound && chown unbound:unbound /run/unbound
EXPOSE 53/udp 53/tcp
CMD ["/usr/local/bin/start-unbound.sh"]
