import fs from "node:fs";
import path from "node:path";

export function readPublicJson(relPath: string): unknown | null {
  const cleaned = String(relPath || "").replace(/^\/+/, "");
  const candidates = [
    path.resolve(process.cwd(), cleaned),
    path.resolve(process.cwd(), "public", cleaned.startsWith("public/") ? cleaned.slice("public/".length) : cleaned)
  ];

  for (const absPath of candidates) {
    try {
      if (!fs.existsSync(absPath)) continue;
      const text = fs.readFileSync(absPath, "utf8");
      return JSON.parse(text);
    } catch {
      // deterministic null fallback for unreadable/invalid json
    }
  }
  return null;
}

export function getCachedSystemsIndex(): any | null {
  return readPublicJson("data/portfolio/systems_index.json") as any | null;
}

export function getCachedRegimeState(): any | null {
  return readPublicJson("data/orca/regime_state.json") as any | null;
}
