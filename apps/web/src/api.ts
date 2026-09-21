import type { DecideFacts, DecideResponse, Direction } from "@jev-snake/game";

export type Health = { ok: boolean; hasKey: boolean };

export async function fetchHealth(): Promise<Health> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`health ${res.status}`);
  return (await res.json()) as Health;
}

export async function decide(
  facts: DecideFacts,
  override?: Direction,
): Promise<DecideResponse> {
  const res = await fetch("/api/decide", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ facts, override }),
  });
  const body = (await res.json()) as DecideResponse & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || `decide ${res.status}`);
  }
  return body;
}
