import http from "node:http";

const host = "127.0.0.1";
const port = Number(process.env.LOCAL_AI_RELAY_PORT || 8789);
const upstreamOrigin = process.env.OPENAI_UPSTREAM_ORIGIN || "https://api.openai.com";
const allowedPaths = new Set([
  "/v1/responses",
  "/v1/chat/completions",
  "/v1/models",
]);

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function fetchWithRetry(url, init) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    if (!allowedPaths.has(url.pathname) || !["GET", "POST"].includes(request.method || "")) {
      sendJson(response, 404, { error: "Route is not available" });
      return;
    }

    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 2_000_000) {
        sendJson(response, 413, { error: "Request is too large" });
        return;
      }
      chunks.push(chunk);
    }

    const headers = {
      accept: request.headers.accept || "application/json",
      "content-type": request.headers["content-type"] || "application/json",
    };
    if (request.headers.authorization) headers.authorization = request.headers.authorization;

    const upstream = await fetchWithRetry(new URL(`${url.pathname}${url.search}`, upstreamOrigin), {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : Buffer.concat(chunks),
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    const responseHeaders = {
      "content-type": upstream.headers.get("content-type") || "application/json",
    };
    const requestId = upstream.headers.get("x-request-id");
    if (requestId) responseHeaders["x-request-id"] = requestId;
    response.writeHead(upstream.status, responseHeaders);
    response.end(body);
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "OpenAI relay failed",
    });
  }
});

server.listen(port, host, () => {
  console.log(`Local OpenAI relay ready on http://${host}:${port}`);
});

function stop() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
