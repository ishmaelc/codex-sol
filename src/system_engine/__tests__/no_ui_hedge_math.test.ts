import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("no UI hedge math recomputation in canonical systems view", () => {
  const uiFiles = [path.resolve(process.cwd(), "public/orca.html")];
  const forbiddenPatterns = [
    "totalLong - totalShort",
    "/ totalLong",
    "liqPrice -",
    "rangeLower -",
    "critical >",
    "hedgeRatio <",
    "liqBufferRatio <",
    "rangeBufferRatio <",
    "totalShortSOL / totalLongSOL"
  ];

  for (const filePath of uiFiles) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const pattern of forbiddenPatterns) {
      assert.equal(
        content.includes(pattern),
        false,
        `forbidden hedge math pattern \"${pattern}\" found in ${filePath}`
      );
    }
  }
});
