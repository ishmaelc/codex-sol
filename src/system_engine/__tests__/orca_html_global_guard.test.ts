import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("orca html global guard excludes high-signal range recompute strings", () => {
  const filePath = path.resolve(process.cwd(), "public/orca.html");
  const html = fs.readFileSync(filePath, "utf8");

  const forbiddenPatterns = ["closest/width", "upper - lower", "mark - lower"];
  for (const pattern of forbiddenPatterns) {
    assert.equal(html.includes(pattern), false, `orca.html must not contain pattern: ${pattern}`);
  }
});
