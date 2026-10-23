import { describe, expect, it } from "vitest";
import type { SignRequest } from "./requests";
import { diffRequests, newsText } from "./watch";

const person = (id: string, name: string, status: SignRequest["recipients"][number]["status"], role: "signer" | "cc" = "signer") => ({
  id,
  position: 1,
  name,
  email: `${id}@example.com`,
  role,
  status,
  notifiedAt: null,
  openedAt: null,
  signedAt: status === "signed" ? "2026-10-23T10:00:00Z" : null,
  declinedAt: null,
  declineReason: null,
  remindedAt: null,
});
const req = (status: SignRequest["status"], recipients: SignRequest["recipients"]): SignRequest => ({
  id: "r1",
  title: "Lease agreement",
  status,
  sequential: true,
  reminderDays: 3,
  createdAt: "2026-10-23T09:00:00Z",
  sentAt: "2026-10-23T09:00:00Z",
  endedAt: null,
  expiresAt: "2026-11-22T09:00:00Z",
  filesDeleted: false,
  docSha256: "x",
  finalSha256: null,
  recipients,
});

describe("agreements news", () => {
  it("says nothing the first time it sees a request", () => {
    const { news, seen } = diffRequests([req("sent", [person("a", "Alex", "notified"), person("b", "Sam", "waiting")])], {});
    expect(news).toEqual([]);
    expect(seen.r1).toEqual({ status: "sent", signed: [] });
  });

  it("tells who signed, with progress", () => {
    const first = diffRequests([req("sent", [person("a", "Alex", "notified"), person("b", "Sam", "waiting")])], {});
    const { news } = diffRequests([req("sent", [person("a", "Alex", "signed"), person("b", "Sam", "notified")])], first.seen, 5);
    expect(news).toEqual([{ id: "r1", title: "Lease agreement", kind: "signed", who: "Alex", progress: "1 of 2 signed", at: 5 }]);
    expect(newsText(news[0])).toBe('Alex signed "Lease agreement" (1 of 2 signed).');
  });

  it("completion wins over the last signature, and copies (cc) don't count as signers", () => {
    const before = diffRequests([req("sent", [person("a", "Alex", "signed"), person("b", "Sam", "notified"), person("c", "Kim", "waiting", "cc")])], {});
    const { news } = diffRequests([req("completed", [person("a", "Alex", "signed"), person("b", "Sam", "signed"), person("c", "Kim", "waiting", "cc")])], before.seen);
    expect(news.map((n) => n.kind)).toEqual(["completed"]);
    expect(newsText(news[0])).toContain("Everyone signed");
  });

  it("reports a decline with the person's name, and stays quiet when nothing changed", () => {
    const before = diffRequests([req("sent", [person("a", "Alex", "notified")])], {});
    const declined = diffRequests([req("declined", [person("a", "Alex", "declined")])], before.seen);
    expect(declined.news[0]).toMatchObject({ kind: "declined", who: "Alex" });
    expect(diffRequests([req("declined", [person("a", "Alex", "declined")])], declined.seen).news).toEqual([]);
  });
});
