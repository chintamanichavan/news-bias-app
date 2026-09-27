FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./
# sources.json ships with the image; the db lives on the mounted volume
COPY data/sources.json /app/seed/sources.json

ENV ARTHA_DB_PATH=/app/data/news_bias.db
VOLUME /app/data

# The feed manager reads data/sources.json — copy the seed in if the volume
# is empty, then serve.
CMD ["sh", "-c", "mkdir -p /app/data && [ -f /app/data/sources.json ] || cp /app/seed/sources.json /app/data/sources.json; exec uvicorn main:app --host 0.0.0.0 --port 8421"]
