import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectFiles(full, out);
    else out.push(full);
  }
  return out;
}

describe("segurança do frontend", () => {
  it("nenhuma chave/URL do provider de geocodificação existe no código do frontend", () => {
    const frontendSrc = path.join(__dirname, "..", "..", "frontend", "src");
    const files = collectFiles(frontendSrc);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      expect(content, file).not.toContain("GOOGLE_GEOCODING_API_KEY");
      expect(content, file).not.toContain("maps.googleapis.com");
      expect(content, file).not.toContain("VITE_COVERAGE_API_KEY");
    }
  });
});
