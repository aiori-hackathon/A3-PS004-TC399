FROM python:3.12-slim

# Install GnuPG and CA certificates for OpenPGP signature verification and HTTPS downloads
RUN apt-get update && \
    apt-get install -y --no-install-recommends gnupg ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY requirements.txt /app/src/apnic/requirements.txt
RUN pip install --no-cache-dir -r /app/src/apnic/requirements.txt

# Copy source code
COPY . /app/src/apnic

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1
ENV APNIC_DATA_DIR=/data/apnic
ENV APNIC_DB_PATH=/data/apnic/apnic.db

CMD ["python", "-m", "src.apnic.updater", "--daemon"]
