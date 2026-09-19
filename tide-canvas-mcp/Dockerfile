FROM golang:1.26-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/flowlight-mcp .

FROM alpine:3.23
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 mcp
COPY --from=builder /out/flowlight-mcp /usr/local/bin/flowlight-mcp
USER mcp
ENV MCP_ADDR=127.0.0.1:8082
EXPOSE 8082
ENTRYPOINT ["flowlight-mcp"]
