import { app, type HttpResponseInit } from "@azure/functions";

interface HealthResponse {
  status: "ok";
  service: "concert-ticket-platform-api";
  timestamp: string;
}

export function healthHandler(): HttpResponseInit {
  const response: HealthResponse = {
    status: "ok",
    service: "concert-ticket-platform-api",
    timestamp: new Date().toISOString(),
  };

  return {
    status: 200,
    jsonBody: response,
    headers: {
      "Cache-Control": "no-store",
    },
  };
}

app.http("health", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "health",
  handler: healthHandler,
});
