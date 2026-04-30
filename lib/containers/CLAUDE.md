# lib/containers/ — Container Streaming

Two SSE endpoints — both authenticated via `auth()` session.

## `stream.js` — Container Status

- **Endpoint**: `/stream/containers`
- **Events**: `containers` (every 3s with full container list + CPU/memory stats), `ping` (keepalive every 15s)
- **Data source**: `listNetworkContainers()` + `getContainerStats()` from `lib/tools/docker.js`. Filtered to containers on the event-handler's Docker network (auto-detected at boot).
- **Client**: `ContainersPage` connects via `new EventSource('/stream/containers')`

## `logs.js` — Container Log Tail

- **Endpoint**: `/stream/containers/logs?name=<containerName>&cleanup=<bool>`
- **Events**: raw log lines as SSE `data:` frames
- **Data source**: Docker `containers/{id}/logs?follow=true&stdout=1&stderr=1` via the multiplexed-stream parser in `lib/tools/docker.js`
- **Client**: `ContainerLogsView` (used from the Containers admin page when a row's logs are expanded). Workspace command containers connect with `cleanup=true`.
- **`cleanup=true`**: the endpoint removes the container on every terminal path (stream error, tail-setup error, post-exit success, post-exit error). This is required for the per-run unique-named workspace command containers (`command-<cmd>-<shortId>-<rand8>`) to avoid host accumulation.

Both endpoints share the same network filter and frame-decoding logic so all SSE consumers see the same view.
