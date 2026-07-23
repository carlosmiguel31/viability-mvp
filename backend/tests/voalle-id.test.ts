import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { compareVoalleIds } from "../src/utils/voalle-id";

describe("compareVoalleIds (bigint como string)", () => {
  it("ordena numericamente com BigInt, sem perder precisao", () => {
    // Acima de Number.MAX_SAFE_INTEGER: como Number, os dois virariam iguais.
    const a = "9007199254740993";
    const b = "9007199254740992";
    expect(Number(a) === Number(b)).toBe(true); // demonstra a perda com Number
    expect(compareVoalleIds(b, a)).toBe(-1);
    expect(compareVoalleIds(a, b)).toBe(1);
    expect(compareVoalleIds(a, a)).toBe(0);
  });

  it("ordena '9' antes de '10' (numerico, nao lexicografico)", () => {
    expect(compareVoalleIds("9", "10")).toBe(-1);
    expect(["10", "9", "2485"].sort(compareVoalleIds)).toEqual(["9", "10", "2485"]);
  });

  it("fallback deterministico por string para valores inesperados", () => {
    expect(compareVoalleIds("abc", "abd")).toBe(-1);
    expect(compareVoalleIds("abc", "abc")).toBe(0);
    expect(compareVoalleIds("10", "abc")).toBe(-1);
  });
});

describe(".gitignore protege o KML real", () => {
  it("ignora data/*.kml e data/*.kmz, liberando apenas o demo", () => {
    const gitignore = readFileSync(path.join(__dirname, "..", ".gitignore"), "utf-8");
    expect(gitignore).toContain("data/*.kml");
    expect(gitignore).toContain("data/*.kmz");
    expect(gitignore).toContain("!data/rede-neutra-mancha-demo.kml");
    expect(gitignore).toContain("!data/.gitkeep");
  });
});
