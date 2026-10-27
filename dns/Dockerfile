FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    bind9 bind9-utils dnsutils openssl python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY named.conf /etc/bind/named.conf
COPY zone/aegis.test.zone /opt/aegisdns/aegis.test.zone
COPY zone/insecure.aegis.test.zone /opt/aegisdns/insecure.aegis.test.zone
COPY scripts/setup-zone.sh /usr/local/sbin/setup-zone.sh
RUN chmod +x /usr/local/sbin/setup-zone.sh && mkdir -p /var/lib/bind/generated /run/named && chown -R bind:bind /var/lib/bind/generated /run/named

EXPOSE 53/udp 53/tcp
CMD ["/usr/local/sbin/setup-zone.sh"]
