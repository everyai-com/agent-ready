/**
 * Console session auth (console-plan §4).
 *
 * v1 is a single owner password (`CONSOLE_PASSWORD` / the `password` option).
 * On success we set a signed, httpOnly, `SameSite=Lax` session cookie. The
 * signature is an HMAC-SHA256 over the session payload, keyed by a secret
 * derived from the password itself via WebCrypto (no extra secret to
 * provision, and the password never appears in the cookie). No password
 * configured => the console is disabled outright, never left open.
 */

const COOKIE_NAME = "console_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPad = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(withPad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(password: string): Promise<CryptoKey> {
  const enc = new TextEncoder().encode(`agent-ready-console:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Constant-time-ish string compare (defeats trivial short-circuit timing). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function verifyPassword(candidate: string, expected: string): boolean {
  return safeEqual(candidate, expected);
}

/** Mint a signed session token: `<base64url payload>.<base64url signature>`. */
export async function createSessionToken(password: string): Promise<string> {
  const payload = JSON.stringify({ exp: Date.now() + SESSION_TTL_MS });
  const payloadBytes = new TextEncoder().encode(payload);
  const key = await hmacKey(password);
  const sig = await crypto.subtle.sign("HMAC", key, payloadBytes);
  return `${toBase64Url(payloadBytes)}.${toBase64Url(new Uint8Array(sig))}`;
}

/** Verify a session token against the configured password. */
export async function verifySessionToken(
  token: string,
  password: string,
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadPart, sigPart] = parts;
  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = fromBase64Url(payloadPart);
    sigBytes = fromBase64Url(sigPart);
  } catch {
    return false;
  }
  const key = await hmacKey(password);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes.slice().buffer,
    payloadBytes.slice().buffer,
  );
  if (!valid) return false;

  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as { exp?: number };
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return false;
  } catch {
    return false;
  }
  return true;
}

export function sessionCookieHeader(token: string, secure: boolean): string {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearSessionCookieHeader(secure: boolean): string {
  const attrs = [`${COOKIE_NAME}=`, "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name === COOKIE_NAME) return part.slice(idx + 1).trim();
  }
  return null;
}

export async function isAuthenticated(
  request: Request,
  password: string,
): Promise<boolean> {
  const token = readSessionCookie(request);
  if (!token) return false;
  return verifySessionToken(token, password);
}
