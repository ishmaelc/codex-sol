import fs from "node:fs/promises";
import path from "node:path";
import { json } from "./_utils.js";

export default async function handler(req: any, res: any) {
  if (req.method && req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  try {
    const filePath = path.resolve(process.cwd(), "public/data/orca/pool_rankings.json");
    const raw = await fs.readFile(filePath, "utf8");
    return json(res, 200, JSON.parse(raw));
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
