FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app/collector

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY . .
RUN corepack enable \
    && corepack prepare pnpm@11.21.0 --activate \
    && pnpm install --frozen-lockfile

CMD ["pnpm", "run", "run:8xbet-worker"]
