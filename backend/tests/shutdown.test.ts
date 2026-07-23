import { describe, expect, it, vi } from "vitest";
import { shutdown } from "../src/shutdown";

describe("graceful shutdown", () => {
  it("fecha o servidor HTTP e o pool do PostgreSQL", async () => {
    const closeServer = vi.fn((cb?: (err?: Error) => void) => {
      cb?.();
      return undefined as never;
    });
    const closePool = vi.fn().mockResolvedValue(undefined);

    await shutdown({ close: closeServer } as never, closePool);

    expect(closeServer).toHaveBeenCalledTimes(1);
    expect(closePool).toHaveBeenCalledTimes(1);
  });
});
