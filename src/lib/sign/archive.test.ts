import { beforeEach, describe, expect, it } from "vitest";
import { keptFileName, keptPath, toKeep } from "./archive";
import { groupOf, matchesQuery, type SignRequest } from "./requests";

const req = (over: Partial<SignRequest> = {}): SignRequest => ({
  id: "3f2a9c1b-0000-4000-8000-000000000001",
  title: "Lease agreement",
  status: "completed",
  sequential: true,
  reminderDays: 3,
  createdAt: "2026-10-23T09:00:00Z",
  sentAt: "2026-10-23T09:00:00Z",
  endedAt: "2026-11-01T15:30:00Z",
  expiresAt: "2026-11-22T09:00:00Z",
  filesDeleted: false,
  docSha256: "x",
  finalSha256: "y",
  recipients: [
    {
      id: "p1",
      position: 1,
      name: "Priya Shah",
      email: "priya@example.com",
      role: "signer",
      status: "signed",
      notifiedAt: null,
      openedAt: null,
      signedAt: "2026-11-01T15:00:00Z",
      declinedAt: null,
      declineReason: null,
      remindedAt: null,
    },
  ],
  ...over,
});

// A valid-looking 256-bit key (base64url) for the key store.
const KEY = "A".repeat(43);

// A Map-backed localStorage, so the tests don't depend on the environment's.
beforeEach(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
  });
});

describe("kept signed copies", () => {
  it("names the file by title, completion day and request id", () => {
    expect(keptFileName(req())).toBe("Lease agreement - signed 2026-11-01 - 3f2a9c1b.pdf");
  });

  it("drops characters Windows can't use in a file name", () => {
    expect(keptFileName(req({ title: 'Lease: "Unit 4" / B?' }))).toBe("Lease Unit 4 B - signed 2026-11-01 - 3f2a9c1b.pdf");
    expect(keptFileName(req({ title: "///" }))).toBe("Agreement - signed 2026-11-01 - 3f2a9c1b.pdf");
  });

  it("keeps only completed requests whose files are still there and whose key is on this computer", () => {
    localStorage.setItem("deskfolio-sign-keys", JSON.stringify({ a: KEY, b: KEY, c: KEY }));
    const list = [req({ id: "a" }), req({ id: "b", status: "sent" }), req({ id: "c", filesDeleted: true }), req({ id: "d" })];
    expect(toKeep(list).map((r) => r.id)).toEqual(["a"]);
  });

  it("doesn't keep a copy twice", () => {
    localStorage.setItem("deskfolio-sign-keys", JSON.stringify({ a: KEY }));
    localStorage.setItem("deskfolio-sign-kept", JSON.stringify({ a: "C:\\Docs\\a.pdf" }));
    expect(keptPath("a")).toBe("C:\\Docs\\a.pdf");
    expect(toKeep([req({ id: "a" })])).toEqual([]);
  });
});

describe("Agreements filters", () => {
  it("groups statuses into tabs", () => {
    const open: SignRequest["status"][] = ["draft", "sent", "signed"];
    const closed: SignRequest["status"][] = ["declined", "voided", "expired"];
    expect(open.map(groupOf)).toEqual(["open", "open", "open"]);
    expect(groupOf("completed")).toBe("completed");
    expect(closed.map(groupOf)).toEqual(["closed", "closed", "closed"]);
  });

  it("searches title, people and id", () => {
    const r = req();
    expect(matchesQuery(r, "")).toBe(true);
    expect(matchesQuery(r, "LEASE")).toBe(true);
    expect(matchesQuery(r, "priya")).toBe(true);
    expect(matchesQuery(r, "@example.com")).toBe(true);
    expect(matchesQuery(r, "3f2a9c")).toBe(true);
    expect(matchesQuery(r, "invoice")).toBe(false);
  });
});
