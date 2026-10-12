import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { fillForm, listFields } from "./forms";
import { along, applyStamps, unsupportedChars } from "./stamp";

async function formPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([595, 842]);
  const p2 = doc.addPage([595, 842]);
  const form = doc.getForm();
  form.createTextField("name").addToPage(p1, { x: 100, y: 700, width: 200, height: 24 });
  form.createCheckBox("agree").addToPage(p1, { x: 100, y: 650, width: 16, height: 16 });
  const dd = form.createDropdown("country");
  dd.addOptions(["Canada", "India", "UK"]);
  dd.addToPage(p2, { x: 100, y: 700, width: 150, height: 24 });
  const rg = form.createRadioGroup("size");
  rg.addOptionToPage("S", p2, { x: 100, y: 600, width: 14, height: 14 });
  rg.addOptionToPage("L", p2, { x: 140, y: 600, width: 14, height: 14 });
  const ro = form.createTextField("locked");
  ro.setText("fixed");
  ro.enableReadOnly();
  ro.addToPage(p2, { x: 100, y: 500, width: 100, height: 20 });
  return doc.save();
}

describe("forms", () => {
  it("lists fields with their page and rectangle", async () => {
    const fields = await listFields(await formPdf());
    const by = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(Object.keys(by).sort()).toEqual(["agree", "country", "locked", "name", "size"]);
    expect(by.name.kind).toBe("text");
    // pdf-lib widens the box by its half-point border.
    expect(by.name.widgets).toHaveLength(1);
    expect(by.name.widgets[0].page).toBe(0);
    by.name.widgets[0].rect.forEach((v, i) => expect(Math.abs(v - [100, 700, 200, 24][i])).toBeLessThanOrEqual(1));
    expect(by.country.options).toEqual(["Canada", "India", "UK"]);
    expect(by.country.widgets[0].page).toBe(1);
    expect(by.size.widgets.map((w) => w.option)).toEqual(["S", "L"]);
    expect(by.locked.readOnly).toBe(true);
  });

  it("fills values, skips read-only, and can flatten", async () => {
    const filled = await fillForm(await formPdf(), { name: "Alex Morgan", agree: "true", country: "India", size: "L", locked: "changed", nope: "x" });
    const by = Object.fromEntries((await listFields(filled)).map((f) => [f.name, f.value]));
    expect(by).toMatchObject({ name: "Alex Morgan", agree: "true", country: "India", size: "L", locked: "fixed" });

    const flat = await fillForm(await formPdf(), { name: "Alex" }, true);
    expect(await listFields(flat)).toEqual([]);
  });
});

describe("stamps", () => {
  it("maps directions on rotated pages", () => {
    expect(along(0, 10, 2)).toEqual([10, 2]);
    expect(along(90, 10, 2)).toEqual([-2, 10]);
    expect(along(180, 10, 2)).toEqual([-10, -2]);
    expect(along(270, 10, 2)).toEqual([2, -10]);
  });

  it("knows which characters Helvetica can't show", () => {
    expect(unsupportedChars("Héllo – “quoted” €5")).toEqual([]);
    expect(unsupportedChars("ਪੰਜਾਬ ok 😀")).toEqual(["ਪ", "ੰ", "ਜ", "ਾ", "ਬ", "😀"]);
  });

  it("draws text, marks and an image, also on a rotated page", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const rotated = doc.addPage([595, 842]);
    rotated.setRotation({ type: "degrees", angle: 90 } as never);
    const src = await doc.save();
    const png = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="),
      (c) => c.charCodeAt(0),
    );
    const base = { width: 120, height: 30, pageRotation: 0 };
    const out = await applyStamps(src, [
      { ...base, kind: "text", page: 0, x: 72, y: 700, text: "Alex Morgan\n12 Oct 2026", fontSize: 12 },
      { ...base, kind: "check", page: 0, x: 72, y: 600, width: 14, height: 14 },
      { ...base, kind: "image", page: 1, x: 300, y: 100, bytes: png, type: "image/png", pageRotation: 90 },
    ]);
    const back = await PDFDocument.load(out);
    expect(back.getPageCount()).toBe(2);
    expect(out.length).toBeGreaterThan(src.length);
    await expect(
      applyStamps(src, [{ ...base, kind: "text", page: 0, x: 0, y: 0, text: "ਪੰਜਾਬ", fontSize: 12 }]),
    ).rejects.toThrow("can't be added");
    await expect(applyStamps(src, [{ ...base, kind: "check", page: 9, x: 0, y: 0 }])).rejects.toThrow("no page 10");
  });
});
