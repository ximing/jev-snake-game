import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { DIRECTIONS, type DecideFacts, type Direction } from "@jev-snake/game";
import { decideMove, keyStatus } from "./jev.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: resolve(root, ".env") });

const PORT = Number(process.env.PORT ?? 8787);

const app = new Hono();
app.use(
  "/api/*",
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.get("/api/health", (c) => {
  const { hasKey } = keyStatus();
  return c.json({ ok: true, hasKey });
});

function isDirection(value: unknown): value is Direction {
  return (
    typeof value === "string" && (DIRECTIONS as readonly string[]).includes(value)
  );
}

function isFacts(value: unknown): value is DecideFacts {
  if (!value || typeof value !== "object") return false;
  const facts = value as DecideFacts;
  return (
    typeof facts.tick === "number" &&
    Array.isArray(facts.legalMoves) &&
    Array.isArray(facts.boardMap) &&
    typeof facts.candidates === "object"
  );
}

app.post("/api/decide", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "请求体不是合法 JSON" }, 400);
  }
  const record = body as { facts?: unknown; override?: unknown };
  if (!isFacts(record.facts)) {
    return c.json({ error: "缺少局面 facts" }, 400);
  }
  const override = record.override;
  if (override != null && !isDirection(override)) {
    return c.json({ error: "override 不是合法方向" }, 400);
  }

  try {
    const trace = await decideMove(
      record.facts,
      isDirection(override) ? override : undefined,
    );
    return c.json({
      action: trace.action,
      source: trace.source,
      trace,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "MISSING_API_KEY") {
      return c.json(
        { error: "服务端没有 TYPESAFE_API_KEY，请写在仓库根目录 .env 里。" },
        503,
      );
    }
    console.error("[decide]", err);
    return c.json({ error: message || "Jev 调用失败" }, 502);
  }
});

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => {
  const { hasKey } = keyStatus();
  console.log(
    `[jev-snake] server http://127.0.0.1:${info.port}  key=${hasKey ? "ok" : "missing"}`,
  );
});
