import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { asNumber, blocksToText, toBlocks, toLines, type TextBit } from "./layout";
import { buildXlsx, colName, sheetNames } from "./xlsx";

/** A word at (x, top) in 10-point text; width ~5 per character. */
const w = (str: string, x: number, top: number, size = 10): TextBit => ({ str, x, top, width: str.length * size * 0.5, size });

describe("layout", () => {
  it("puts pieces into lines in reading order, with spaces where there are gaps", () => {
    const lines = toLines([w("world", 100, 50), w("Hello", 60, 50.5), w("Second", 60, 64), w("line", 95, 64)]);
    expect(lines.map((l) => l.text)).toEqual(["Hello world", "Second line"]);
  });

  it("joins wrapped lines into one paragraph and mends hyphenated words", () => {
    const lines = toLines([
      w("Report", 60, 30, 20),
      w("This is a para-", 60, 60),
      w("graph that wraps.", 60, 72),
      w("Next paragraph.", 60, 100),
    ]);
    const blocks = toBlocks(lines);
    expect(blocks).toEqual([
      { kind: "para", text: "Report", size: 20, heading: true, bold: false },
      { kind: "para", text: "This is a paragraph that wraps.", size: 10, heading: false, bold: false },
      { kind: "para", text: "Next paragraph.", size: 10, heading: false, bold: false },
    ]);
  });

  it("finds a table from lines with aligned columns", () => {
    const rows = [
      ["Item", "Qty", "Price"],
      ["Apples", "3", "1.50"],
      ["Bananas and pears", "12", "1,204.00"],
    ];
    const bits = rows.flatMap((r, i) => [w(r[0], 60, 100 + i * 14), w(r[1], 200, 100 + i * 14), w(r[2], 260, 100 + i * 14)]);
    const blocks = toBlocks(toLines([w("Prices", 60, 80), ...bits]));
    expect(blocks[0]).toMatchObject({ kind: "para", text: "Prices" });
    expect(blocks[1]).toEqual({ kind: "table", rows });
    expect(blocksToText([blocks])).toBe("Prices\n\nItem\tQty\tPrice\nApples\t3\t1.50\nBananas and pears\t12\t1,204.00");
  });

  it("reads numbers only when they clearly are numbers", () => {
    expect(asNumber("1,204.00")).toBe(1204);
    expect(asNumber("-3")).toBe(-3);
    expect(asNumber("(25.5)")).toBe(-25.5);
    expect(asNumber("12%")).toBe(0.12);
    expect(asNumber("$1,000")).toBe(1000);
    expect(asNumber("2026-10-11")).toBeNull();
    expect(asNumber("12 Nov")).toBeNull();
    expect(asNumber("007")).toBe(7);
    expect(asNumber("")).toBeNull();
  });
});

describe("xlsx", () => {
  it("names columns and sheets the way Excel wants", () => {
    expect([0, 25, 26, 27, 701, 702].map(colName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    expect(sheetNames(["Page 1", "Page 1", "a/b:c", "", "x".repeat(40)])).toEqual([
      "Page 1",
      "Page 1 2",
      "a b c",
      "Sheet4",
      "x".repeat(31),
    ]);
  });

  it("writes a workbook with text, numbers and escaped characters", () => {
    const bytes = buildXlsx([
      { name: "Page 1", rows: [["Item", "Qty"], ["Fish & <chips>", 3]] },
      { name: "Page 2", rows: [] },
    ]);
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    const s1 = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(s1).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">Fish &amp; &lt;chips&gt;</t></is></c>');
    expect(s1).toContain('<c r="B2"><v>3</v></c>');
    expect(strFromU8(files["xl/workbook.xml"])).toContain('<sheet name="Page 2" sheetId="2" r:id="rId2"/>');
  });
});
