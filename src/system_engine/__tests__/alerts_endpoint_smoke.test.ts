import test from "node:test";
import assert from "node:assert/strict";
import { createAlertsHandler } from "../../server.js";

class MockResponse {
  statusCode = 200;
  headers = new Map<string, string>();
  body: unknown = null;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string): this {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  json(payload: unknown): this {
    this.setHeader("content-type", "application/json; charset=utf-8");
    this.body = payload;
    return this;
  }
}

test("alerts endpoint handler returns JSON payload shape", async () => {
  const handler = createAlertsHandler({
    getAlertsPayload: async () => ({
      asOfTs: "2026-02-27T00:00:00.000Z",
      portfolio: { health: { overall: "strong" }, capitalGuard: { level: "none", triggers: [] } },
      systems: [],
      attention: { level: "none", systemCount: 0, systems: [], triggers: [] }
    })
  });

  const req = { query: { wallet: "abc" } } as any;
  const res = new MockResponse() as any;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.ok(String(res.headers.get("content-type") ?? "").includes("application/json"));
  assert.ok(res.body && typeof res.body === "object");
  const body = res.body as Record<string, unknown>;
  assert.ok("portfolio" in body);
  assert.ok("systems" in body);
  assert.ok("attention" in body);
});
