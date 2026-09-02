import { describe, it, expect } from "vitest";
import { validateStorageRoot } from "@/lib/storage";

describe("G2 storage durability guard (Closure C1 / CHECK 2)", () => {
  it("dev/test allows any root (including /tmp)", () => {
    expect(() => validateStorageRoot("/tmp/x", false)).not.toThrow();
    expect(() => validateStorageRoot(undefined, false)).not.toThrow();
  });

  it("production REFUSES an unset root (fail-closed)", () => {
    expect(() => validateStorageRoot(undefined, true)).toThrow();
  });

  it("production REFUSES an ephemeral /tmp root", () => {
    expect(() => validateStorageRoot("/tmp/sarat-object-store", true)).toThrow();
  });

  it("production REFUSES a relative root", () => {
    expect(() => validateStorageRoot("relative/dir", true)).toThrow();
  });

  it("production ACCEPTS an absolute persistent root", () => {
    expect(() => validateStorageRoot("/var/lib/sarat/object-store", true)).not.toThrow();
  });
});
