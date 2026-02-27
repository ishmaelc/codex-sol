import type { SystemLabel } from "./types.js";

export function mapStatusToLabel(status: string): SystemLabel {
  const normalized = String(status).toLowerCase();
  if (normalized === "green") return "GREEN";
  if (normalized === "yellow" || normalized === "orange") return "YELLOW";
  return "RED";
}
