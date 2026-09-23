import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): string {
  const buf = readFileSync(file);
  expect(buf.subarray(1, 4).toString("ascii"), `${file} is not a PNG`).toBe("PNG");
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

describe("web app manifest", () => {
  const m = manifest();

  it("declares what Chrome needs to offer installation", () => {
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.icons?.some((i) => i.sizes === "192x192" && i.purpose !== "maskable")).toBe(true);
    expect(m.icons?.some((i) => i.sizes === "512x512" && i.purpose !== "maskable")).toBe(true);
    expect(m.icons?.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("points every icon at a committed PNG of the declared size", () => {
    for (const icon of m.icons ?? []) {
      const file = path.join(process.cwd(), "public", icon.src);
      expect(pngSize(file), icon.src).toBe(icon.sizes);
    }
  });

  it("ships a PNG apple-touch-icon, which iOS requires (it ignores SVG)", () => {
    expect(pngSize(path.join(process.cwd(), "src", "app", "apple-icon.png"))).toBe("180x180");
  });
});
