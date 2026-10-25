import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { logActivity } from "../activityLog.js";
import { jsonResponse, localLoginEnabled, login } from "../auth.js";

export async function loginHandler(request: HttpRequest): Promise<HttpResponseInit> {
  if (!localLoginEnabled()) {
    return jsonResponse(403, {
      error: {
        code: "AUTHENTICATION_REQUIRED",
        message: "Login is available only in local development.",
      },
    });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    body = undefined;
  }

  const username =
    typeof body === "object" && body !== null && "username" in body ? body.username : undefined;
  const password =
    typeof body === "object" && body !== null && "password" in body ? body.password : undefined;

  if (typeof username !== "string" || typeof password !== "string" || username.length > 64) {
    return jsonResponse(400, {
      error: { code: "INVALID_REQUEST", message: "Provide a username and password." },
    });
  }

  const result = login(username, password);

  if (!result.ok) {
    logActivity("LOGIN_FAILED", username.slice(0, 32), result.code);
    return jsonResponse(result.status, { error: { code: result.code, message: result.message } });
  }

  logActivity("LOGIN", result.user.username, `role=${result.user.role}`);
  return jsonResponse(200, { token: result.token, user: result.user });
}

app.http("login", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "auth/login",
  handler: loginHandler,
});
