import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache.js", () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/headers.js", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { createAuthHandler } from "../src/next/server.js";
import { BASE, json, mockFetch, wpError } from "./helpers.js";

const sessionBody = {
  access_token: "jwt-1",
  token_type: "Bearer",
  expires_in: 900,
  refresh_token: "7.refresh",
  refresh_expires_in: 3600,
  cart_token: "customer-cart",
  customer: { id: 7 },
};

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://shop.test/api/auth/${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Origin: "https://shop.test", ...headers },
  });
}

describe("createAuthHandler", () => {
  it("signs in, keeps the refresh token in an httpOnly cookie and hides it from the body", async () => {
    const { fetch, calls } = mockFetch(() => json(sessionBody));
    const { POST } = createAuthHandler({ baseUrl: BASE, fetch, secretKey: "hp_sk_1" });
    const response = await POST(
      post("login", { email: "ana@example.com", password: "x", admin: true }, { "Cart-Token": "guest", "X-Headpress-Captcha": "cap", "X-Forwarded-For": "203.0.113.9" }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ access_token: "jwt-1", expires_in: 900, cart_token: "customer-cart", customer: { id: 7 } });
    const cookies = response.headers.getSetCookie();
    expect(cookies[0]).toMatch(/^hp_rt=7\.refresh; Path=\/api\/auth; Max-Age=3600; SameSite=Lax; HttpOnly; Secure$/);
    expect(cookies[1]).toMatch(/^hp_session=1; Path=\/; Max-Age=3600; SameSite=Lax; Secure$/);

    // Only allowed fields, with the shopper's cart, captcha and IP.
    expect(await calls[0]?.json()).toEqual({ login: "ana@example.com", password: "x" });
    expect(calls[0]?.headers.get("Cart-Token")).toBe("guest");
    expect(calls[0]?.headers.get("X-Headpress-Captcha")).toBe("cap");
    expect(calls[0]?.headers.get("X-Headpress-Client-IP")).toBe("203.0.113.9");
    expect(calls[0]?.headers.get("X-Headpress-Secret")).toBe("hp_sk_1");
  });

  it("refreshes from the cookie and adds the customer", async () => {
    const { fetch, calls } = mockFetch((request) =>
      request.url.endsWith("/store/auth/refresh") ? json({ ...sessionBody, refresh_token: "7.rotated", cart_token: undefined }) : json({ id: 7, email: "a" }),
    );
    const { POST } = createAuthHandler({ baseUrl: BASE, fetch });
    const response = await POST(post("refresh", {}, { Cookie: "hp_rt=7.refresh; hp_session=1" }));
    expect(response.status).toBe(200);
    expect(await calls[0]?.json()).toEqual({ refresh_token: "7.refresh" });
    expect(calls[1]?.headers.get("Authorization")).toBe("Bearer jwt-1");
    expect((await response.json()).customer).toEqual({ id: 7, email: "a" });
    expect(response.headers.getSetCookie()[0]).toContain("hp_rt=7.rotated");
  });

  it("answers 401 and clears the cookies when there is no session or Headpress refuses it", async () => {
    const { fetch } = mockFetch(() => wpError(401, "headpress_unauthorized"));
    const { POST } = createAuthHandler({ baseUrl: BASE, fetch });
    const none = await POST(post("refresh", {}));
    expect(none.status).toBe(401);
    expect(none.headers.getSetCookie()[0]).toContain("Max-Age=0");
    const refused = await POST(post("refresh", {}, { Cookie: "hp_rt=old" }));
    expect(refused.status).toBe(401);
    expect(refused.headers.getSetCookie()).toHaveLength(2);
  });

  it("logs out with the cookie and clears it even when Headpress fails", async () => {
    const { fetch, calls } = mockFetch(() => new Response("", { status: 500 }));
    const { POST } = createAuthHandler({ baseUrl: BASE, fetch });
    const response = await POST(post("logout", {}, { Cookie: "hp_rt=7.refresh" }));
    expect(response.status).toBe(204);
    expect(await calls[0]?.json()).toEqual({ refresh_token: "7.refresh" });
    expect(response.headers.getSetCookie()[0]).toContain("Max-Age=0");
  });

  it("changes the password with the browser's access token and rotates the cookie", async () => {
    const { fetch, calls } = mockFetch(() => json({ ...sessionBody, refresh_token: "7.new" }));
    const { POST } = createAuthHandler({ baseUrl: BASE, fetch });
    expect((await POST(post("password", { password: "newpass123" }))).status).toBe(401);
    const response = await POST(post("password", { password: "newpass123", current_password: "old" }, { Authorization: "Bearer jwt-1" }));
    expect(response.status).toBe(200);
    expect(calls[0]?.headers.get("Authorization")).toBe("Bearer jwt-1");
    expect(response.headers.getSetCookie()[0]).toContain("hp_rt=7.new");
  });

  it("refuses cross-site requests, non-JSON bodies and unknown actions; passes errors through", async () => {
    const { fetch } = mockFetch(() => wpError(409, "headpress_email_exists", "Exists", { login_required: true }));
    const { POST } = createAuthHandler({ baseUrl: BASE, fetch });
    expect((await POST(post("login", {}, { Origin: "https://evil.test" }))).status).toBe(403);
    const form = new Request("https://shop.test/api/auth/login", { method: "POST", body: "login=a", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    expect((await POST(form)).status).toBe(415);
    expect((await POST(post("delete-everything", {}))).status).toBe(404);
    const conflict = await POST(post("register", { email: "a@b.c", password: "12345678" }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "headpress_email_exists", data: { login_required: true } });
  });

  it("passes OTP answers that are not sessions through untouched", async () => {
    const { fetch } = mockFetch(() => json({ needs_registration: true, registration_token: "reg", expires_in: 900 }));
    const { POST } = createAuthHandler({ baseUrl: BASE, fetch });
    const response = await POST(post("otp/verify", { challenge_id: "c", code: "1" }));
    expect(await response.json()).toEqual({ needs_registration: true, registration_token: "reg", expires_in: 900 });
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });
});
