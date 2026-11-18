FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir "pyserial>=3.5,<4"
COPY serial_to_dashboard.py ./serial_to_dashboard.py
ENTRYPOINT ["python", "/app/serial_to_dashboard.py"]
