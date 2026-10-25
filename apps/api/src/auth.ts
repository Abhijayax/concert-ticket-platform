import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { HttpRequest, HttpResponseInit } from "@azure/functions";

export type Role = "user" | "admin";

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  role: Role;
}

// DEMO accounts. Passwords are NOT in source: they are read from environment variables
// (local.settings.json, which is Git-ignored). An account with no password configured cannot log in.
const ACCOUNTS: Record<string, AuthUser & { passwordEnv: string }> = {
  alice: {
    id: "demo-user-alice",
    username: "alice",
    email: "alice@example.com",
    role: "user",
    passwordEnv: "DEMO_PASSWORD_ALICE",
  },
  bob: {
    id: "demo-user-bob",
    username: "bob",
    email: "bob@example.com",
    role: "user",
    passwordEnv: "DEMO_PASSWORD_BOB",
  },
  admin: {
    id: "demo-admin",
    username: "admin",
    email: "admin@example.com",
    role: "admin",
    passwordEnv: "DEMO_PASSWORD_ADMIN",
  },
};

const TOKEN_TTL_SECONDS = 8 * 60 * 60;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 60_000;

export function jsonResponse(status: number, body: unknown): HttpResponseInit {
  return { status, jsonBody: body, headers: { "Cache-Control": "no-store" } };
}

function localDevelopmentEnabled(): boolean {
  return (
    process.env.ALLOW_DEMO_AUTH === "true" ||
    (process.env.NODE_ENV === "development" && !process.env.WEBSITE_SITE_NAME)
  );
}

function signingSecret(): string | undefined {
  const secret = process.env.AUTH_SIGNING_SECRET?.trim();
  return secret && secret.length >= 16 ? secret : undefined;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  // Hash first so both buffers have equal length for timingSafeEqual.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

const failures = new Map<string, { count: number; lockedUntil: number }>();

export type LoginResult =
  | { ok: true; token: string; user: Omit<AuthUser, "id"> & { expiresInSeconds: number } }
  | { ok: false; status: number; code: string; message: string };

export function login(username: string, password: string): LoginResult {
  const secret = signingSecret();

  if (!secret) {
    return {
      ok: false,
      status: 503,
      code: "AUTH_NOT_CONFIGURED",
      message: "Authentication is not configured on this server.",
    };
  }

  const key = username.toLowerCase();
  const state = failures.get(key);

  if (state && state.lockedUntil > Date.now()) {
    return {
      ok: false,
      status: 429,
      code: "TOO_MANY_ATTEMPTS",
      message: "Too many failed attempts. Try again in a minute.",
    };
  }

  const account = Object.hasOwn(ACCOUNTS, key) ? ACCOUNTS[key] : undefined;
  const expected = account ? process.env[account.passwordEnv] : undefined;
  // Always run a comparison so response time does not reveal valid usernames.
  const matches = safeEqual(password, expected ?? "\u0000invalid\u0000");

  if (!account || !expected || !matches) {
    const count = (state?.count ?? 0) + 1;
    failures.set(key, {
      count,
      lockedUntil: count >= MAX_FAILURES ? Date.now() + LOCKOUT_MS : 0,
    });
    if (count >= MAX_FAILURES) {
      failures.set(key, { count: 0, lockedUntil: Date.now() + LOCKOUT_MS });
    }
    return {
      ok: false,
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: "Invalid username or password.",
    };
  }

  failures.delete(key);

  const payload = Buffer.from(
    JSON.stringify({ u: account.username, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }),
  ).toString("base64url");

  return {
    ok: true,
    token: `${payload}.${sign(payload, secret)}`,
    user: {
      username: account.username,
      email: account.email,
      role: account.role,
      expiresInSeconds: TOKEN_TTL_SECONDS,
    },
  };
}

function verifyToken(token: string): AuthUser | undefined {
  const secret = signingSecret();
  const [payload, signature] = token.split(".");

  if (!secret || !payload || !signature || !safeEqual(signature, sign(payload, secret))) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      u?: unknown;
      exp?: unknown;
    };

    if (
      typeof parsed.u !== "string" ||
      typeof parsed.exp !== "number" ||
      parsed.exp < Date.now() / 1000 ||
      !Object.hasOwn(ACCOUNTS, parsed.u)
    ) {
      return undefined;
    }

    const { passwordEnv: _unused, ...user } = ACCOUNTS[parsed.u] as AuthUser & {
      passwordEnv: string;
    };
    void _unused;
    return user;
  } catch {
    return undefined;
  }
}

/** Requires a valid session token with the given role. Local development only. */
export function authenticate(
  request: HttpRequest,
  role: Role,
): { user: AuthUser } | { response: HttpResponseInit } {
  if (!localDevelopmentEnabled()) {
    return {
      response: jsonResponse(403, {
        error: {
          code: "AUTHENTICATION_REQUIRED",
          message: "A verified user identity is required.",
        },
      }),
    };
  }

  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const user = token ? verifyToken(token) : undefined;

  if (!user) {
    return {
      response: jsonResponse(401, {
        error: { code: "UNAUTHENTICATED", message: "Sign in to continue." },
      }),
    };
  }

  if (user.role !== role) {
    return {
      response: jsonResponse(403, {
        error: { code: "FORBIDDEN", message: "You do not have access to this resource." },
      }),
    };
  }

  return { user };
}

export function localLoginEnabled(): boolean {
  return localDevelopmentEnabled();
}
