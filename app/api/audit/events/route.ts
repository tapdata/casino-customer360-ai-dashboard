function auditBridgeUrl() {
  const configuredUrl = process.env.MONGO_AUDIT_HTTP_URL?.replace(/\/$/, "");
  if (configuredUrl) return configuredUrl;
  if (process.env.MONGO_AUDIT_URI || process.env.MONGO_AUDIT_HOST) return `http://127.0.0.1:${process.env.LOCAL_AUDIT_RELAY_PORT || 8790}`;
  return null;
}

function unconfiguredResponse() {
  return Response.json({
    ok: true,
    persisted: false,
    mode: "unconfigured",
    message: "Mongo audit bridge is not configured.",
  }, { status: 202 });
}

function bridgeOfflineResponse(error: unknown) {
  return Response.json({
    ok: true,
    persisted: false,
    mode: "bridge_offline",
    message: "Mongo audit bridge is not running.",
    error: error instanceof Error ? error.message : "Mongo audit bridge is not reachable",
  }, { status: 202 });
}

async function bridgeFetch(path: string, init?: RequestInit) {
  const baseUrl = auditBridgeUrl();
  if (!baseUrl) return null;
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.headers || {}),
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const response = await bridgeFetch("/events", {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") || "application/json" },
      body,
    });
    if (!response) return unconfiguredResponse();

    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") || "application/json" },
    });
  } catch (error) {
    return bridgeOfflineResponse(error);
  }
}

export async function GET() {
  try {
    const response = await bridgeFetch("/events", { method: "GET" });
    if (!response) return unconfiguredResponse();

    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") || "application/json" },
    });
  } catch (error) {
    return bridgeOfflineResponse(error);
  }
}
