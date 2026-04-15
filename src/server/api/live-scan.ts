import type { Context } from "hono";
import { sessions } from "../manager/SessionManager";

/**
 * GET /live-scan?userId=... — current Live Scan status.
 */
export function getLiveScanStatus(c: Context) {
  const userId = c.req.query("userId");
  if (!userId) return c.json({ error: "userId is required" }, 400);

  const user = sessions.get(userId);
  if (!user) return c.json({ error: `No user for ${userId}` }, 404);

  return c.json(user.photo.getLiveScanStatus());
}

/**
 * POST /live-scan — toggle Live Scan on/off.
 * Body: { userId: string, enabled: boolean, intervalMs?: number }
 */
export async function setLiveScanStatus(c: Context) {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const userId = body.userId as string | undefined;
  const enabled = body.enabled as boolean | undefined;
  const intervalMs = body.intervalMs as number | undefined;

  if (!userId) return c.json({ error: "userId is required" }, 400);
  if (typeof enabled !== "boolean") {
    return c.json({ error: "enabled (boolean) is required" }, 400);
  }

  const user = sessions.get(userId);
  if (!user) return c.json({ error: `No user for ${userId}` }, 404);

  if (enabled) user.photo.startLiveScan(intervalMs);
  else user.photo.stopLiveScan();

  return c.json(user.photo.getLiveScanStatus());
}
