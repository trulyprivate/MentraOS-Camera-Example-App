FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

ENV PORT=8000
ENV LOAD_TTS_ON_START=1
ENV ACTIVATION_TIMEOUT=15.0

EXPOSE 8000

CMD ["python", "server.py"]
