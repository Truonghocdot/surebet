FROM mcr.microsoft.com/playwright:v1.54.2-jammy

WORKDIR /app/collector

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY . .
RUN npm ci

CMD ["npm", "run", "run:8xbet-worker"]
