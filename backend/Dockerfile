FROM golang:1.26 AS build

WORKDIR /app

COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/api ./cmd/api

FROM gcr.io/distroless/static-debian12 AS api
COPY --from=build /out/api /api
EXPOSE 8080
ENTRYPOINT ["/api"]
