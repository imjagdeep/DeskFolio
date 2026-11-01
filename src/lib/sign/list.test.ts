import { beforeEach, describe, expect, it, vi } from "vitest";

// The account calls go through Rust; here a stand-in answers them.
const calls: string[] = [];
let pages: Record<string, { envelopes: { id: string }[]; next?: string | null }> = {};
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (_cmd: string, args: { path: string }) => {
    calls.push(args.path);
    const p = pages[args.path];
    if (!p) throw new Error(`unexpected ${args.path}`);
    return p;
  }),
}));

const { listRequests } = await import("./requests");

beforeEach(() => {
  calls.length = 0;
  pages = {};
});

describe("listing requests", () => {
  it("follows the page markers until the last page", async () => {
    pages = {
      "/v1/envelopes": { envelopes: [{ id: "a" }, { id: "b" }], next: "1793549907000002" },
      "/v1/envelopes/before/1793549907000002": { envelopes: [{ id: "c" }], next: null },
    };
    expect((await listRequests()).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(calls).toEqual(["/v1/envelopes", "/v1/envelopes/before/1793549907000002"]);
  });

  it("an older server (no marker) is one page", async () => {
    pages = { "/v1/envelopes": { envelopes: [{ id: "a" }] } };
    expect((await listRequests()).map((r) => r.id)).toEqual(["a"]);
    expect(calls).toEqual(["/v1/envelopes"]);
  });

  it("ignores a marker that isn't a plain number", async () => {
    pages = { "/v1/envelopes": { envelopes: [{ id: "a" }], next: "../../me" } };
    expect((await listRequests()).map((r) => r.id)).toEqual(["a"]);
    expect(calls).toEqual(["/v1/envelopes"]);
  });
});
