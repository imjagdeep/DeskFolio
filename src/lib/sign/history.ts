// The signing history as CSV (Excel opens it): one row per person per request,
// so each signer's invitation, opening, signing or decline time is its own cell.

import type { SignRequest } from "./requests";

const STATUS: Record<SignRequest["status"], string> = {
  draft: "Not sent",
  sent: "Waiting",
  signed: "Everyone signed",
  completed: "Completed",
  declined: "Declined",
  voided: "Cancelled",
  expired: "Expired",
};

/** One CSV cell: quoted when it holds a comma, quote or line break; formulas defused for Excel. */
export function cell(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v);
  // A leading = + - @ makes Excel run the cell as a formula (CSV injection).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEAD = ["Request ID", "Title", "Status", "Sent", "Ended", "Deadline", "Order", "Person", "Email", "Role", "Their status", "Invited", "Opened", "Signed", "Declined", "Decline reason", "Final copy SHA-256"];

export function historyCsv(list: SignRequest[]): string {
  const rows = [HEAD];
  for (const r of list) {
    const people = [...r.recipients].sort((a, b) => a.position - b.position);
    for (const p of people.length ? people : [null]) {
      rows.push([
        r.id, r.title, STATUS[r.status], r.sentAt ?? "", r.endedAt ?? "", r.expiresAt,
        p ? String(p.position) : "", p?.name ?? "", p?.email ?? "", p ? (p.role === "cc" ? "Gets a copy" : "Signer") : "",
        p?.status ?? "", p?.notifiedAt ?? "", p?.openedAt ?? "", p?.signedAt ?? "", p?.declinedAt ?? "", p?.declineReason ?? "", r.finalSha256 ?? "",
      ]);
    }
  }
  // BOM so Excel reads it as UTF-8; CRLF line ends as RFC 4180 says.
  return "﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
