import { beforeEach, describe, expect, it } from "vitest";
import { cell, historyCsv } from "./history";
import { applyTemplate, deleteTemplate, listTemplates, makeTemplate, readTemplate, saveTemplate } from "./templates";
import { summarizeWaiting } from "./watch";
import type { SignRequest } from "./requests";

const req = (id: string, status: SignRequest["status"], expiresAt: string, title = `Request ${id}`): SignRequest => ({
  id, title, status, sequential: true, reminderDays: 3, createdAt: "2026-10-01T10:00:00Z", sentAt: "2026-10-01T10:00:00Z", endedAt: null, expiresAt,
  filesDeleted: false, docSha256: "a", finalSha256: status === "completed" ? "f".repeat(64) : null,
  recipients: [
    { id: `${id}-2`, position: 2, name: "Sam Lee", email: "sam@example.com", role: "signer", status: "waiting", notifiedAt: null, openedAt: null, signedAt: null, declinedAt: null, declineReason: null, remindedAt: null },
    { id: `${id}-1`, position: 1, name: "Priya, Shah", email: "priya@example.com", role: "signer", status: "signed", notifiedAt: "2026-10-01T10:00:00Z", openedAt: null, signedAt: "2026-10-02T09:00:00Z", declinedAt: null, declineReason: null, remindedAt: null },
  ],
});

describe("signing history CSV", () => {
  it("quotes and defuses cells", () => {
    expect(cell('He said "hi", then left')).toBe('"He said ""hi"", then left"');
    expect(cell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(cell("-5")).toBe("'-5");
    expect(cell(null)).toBe("");
  });
  it("has one row per person, in signing order", () => {
    const csv = historyCsv([req("a", "completed", "2026-11-01T00:00:00Z", "Lease")]);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^Request ID,Title,Status/);
    expect(lines[1]).toContain('"Priya, Shah"');
    expect(lines[1]).toContain("2026-10-02T09:00:00Z");
    expect(lines[2]).toContain("Sam Lee");
    expect(lines[1]).toContain("Completed");
  });
});

describe("templates", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) },
    });
  });
  const state = {
    people: [
      { local: "p1", name: "Priya Shah", email: "priya@example.com", role: "signer" as const, position: 1 },
      { local: "p2", name: "Office", email: "office@example.com", role: "cc" as const, position: 99 },
    ],
    fields: [
      { local: "f1", person: "p1", kind: "signature" as const, page: 0, rect: [10, 10, 180, 52] as [number, number, number, number], required: true },
      { local: "f2", person: "p1", kind: "date" as const, page: 4, rect: [10, 60, 120, 78] as [number, number, number, number], required: true },
    ],
    message: "Please sign",
    sequential: false,
    reminderDays: 7,
    expiresDays: 14,
  };

  it("save, list, replace by name, delete", () => {
    saveTemplate(makeTemplate("Lease", state, 5, true));
    saveTemplate(makeTemplate("lease", { ...state, message: "v2" }, 5, true));
    const all = listTemplates();
    expect(all).toHaveLength(1);
    expect(all[0].message).toBe("v2");
    deleteTemplate(all[0].id);
    expect(listTemplates()).toEqual([]);
  });

  it("can leave the names and emails out", () => {
    const t = makeTemplate("Blank", state, 5, false);
    expect(t.people.every((p) => p.name === "" && p.email === "")).toBe(true);
  });

  it("applies with fresh ids and drops fields past the last page", () => {
    let n = 0;
    const s = applyTemplate(makeTemplate("Lease", state, 5, true), 3, (p) => `${p}x${n++}`);
    expect(s.dropped).toBe(1);
    expect(s.fields).toHaveLength(1);
    expect(s.people.map((p) => p.local)).not.toContain("p1");
    expect(s.fields[0].person).toBe(s.people[0].local);
    expect([s.sequential, s.reminderDays, s.expiresDays, s.message]).toEqual([false, 7, 14, "Please sign"]);
  });

  it("skips malformed stored data instead of trusting it", () => {
    expect(readTemplate({ id: "x" })).toBeNull();
    const t = makeTemplate("Lease", state, 5, true);
    const bad = { ...t, fields: [...t.fields, { person: "nobody", kind: "signature", page: 0, rect: [0, 0, 1, 1], required: true }, { person: "p1", kind: "laser", page: 0, rect: [0, 0, 1, 1], required: true }] };
    expect(readTemplate(bad)?.fields).toHaveLength(2);
    localStorage.setItem("deskfolio-sign-templates", "{not json");
    expect(listTemplates()).toEqual([]);
  });
});

describe("waiting summary for Home", () => {
  it("counts open requests and finds the first deadline", () => {
    const w = summarizeWaiting([req("a", "sent", "2026-12-01T00:00:00Z"), req("b", "completed", "2026-11-03T00:00:00Z"), req("c", "signed", "2026-11-20T00:00:00Z", "Soon")]);
    expect(w.count).toBe(2);
    expect(w.soonest?.title).toBe("Soon");
    expect(summarizeWaiting([]).soonest).toBeNull();
  });
});
