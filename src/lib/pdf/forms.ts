// PDF forms (AcroForm): list the fields with where they sit on each page,
// and fill them in. Pure functions over bytes.

import {
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  type PDFDocument,
  type PDFField,
} from "@cantoo/pdf-lib";
import { load, saveDoc, type LoadOpts } from "./ops";

export type FieldKind = "text" | "checkbox" | "radio" | "dropdown" | "list";

export interface FieldWidget {
  /** 0-based page. */
  page: number;
  /** PDF user space: x, y (bottom-left), width, height. */
  rect: [number, number, number, number];
  /** Radio buttons: the option this widget stands for. */
  option?: string;
}

export interface FormField {
  name: string;
  kind: FieldKind;
  /** text/dropdown/radio: the value; checkbox: "true"/"false"; list: values joined by \n. */
  value: string;
  options: string[];
  multiline: boolean;
  readOnly: boolean;
  widgets: FieldWidget[];
}

function kindOf(f: PDFField): FieldKind | null {
  if (f instanceof PDFTextField) return "text";
  if (f instanceof PDFCheckBox) return "checkbox";
  if (f instanceof PDFRadioGroup) return "radio";
  if (f instanceof PDFDropdown) return "dropdown";
  if (f instanceof PDFOptionList) return "list";
  return null; // buttons and signatures fields are not filled here
}

function pageIndexOf(doc: PDFDocument, pageRef: unknown): number {
  const pages = doc.getPages();
  return pages.findIndex((p) => p.ref === pageRef);
}

export async function listFields(bytes: Uint8Array, opts: LoadOpts = {}): Promise<FormField[]> {
  const doc = await load(bytes, opts);
  const form = doc.getForm();
  const out: FormField[] = [];
  for (const f of form.getFields()) {
    const kind = kindOf(f);
    if (!kind) continue;
    const widgets: FieldWidget[] = [];
    const radioOptions = f instanceof PDFRadioGroup ? f.getOptions() : [];
    f.acroField.getWidgets().forEach((w, i) => {
      const pageRef = w.P();
      let page = pageRef ? pageIndexOf(doc, pageRef) : -1;
      if (page < 0) {
        // No /P on the widget: find the page whose annotations list it.
        page = doc.getPages().findIndex((p) => p.node.Annots()?.asArray().some((a) => a === doc.context.getObjectRef(w.dict)));
      }
      if (page < 0) return;
      const r = w.getRectangle();
      widgets.push({ page, rect: [r.x, r.y, r.width, r.height], option: radioOptions[i] });
    });
    let value = "";
    let options: string[] = [];
    let multiline = false;
    if (f instanceof PDFTextField) {
      value = f.getText() ?? "";
      multiline = f.isMultiline();
    } else if (f instanceof PDFCheckBox) value = String(f.isChecked());
    else if (f instanceof PDFRadioGroup) {
      value = f.getSelected() ?? "";
      options = f.getOptions();
    } else if (f instanceof PDFDropdown) {
      value = f.getSelected()[0] ?? "";
      options = f.getOptions();
    } else if (f instanceof PDFOptionList) {
      value = f.getSelected().join("\n");
      options = f.getOptions();
    }
    out.push({ name: f.getName(), kind, value, options, multiline, readOnly: f.isReadOnly(), widgets });
  }
  return out;
}

/**
 * Fill fields by name. Unknown names are ignored; read-only fields are left
 * as they are. `flatten` turns the fields into plain page content so they
 * can't be changed any more.
 */
export async function fillForm(
  bytes: Uint8Array,
  values: Record<string, string>,
  flatten = false,
  opts: LoadOpts = {},
): Promise<Uint8Array> {
  const doc = await load(bytes, opts);
  const form = doc.getForm();
  for (const [name, value] of Object.entries(values)) {
    const f = form.getFieldMaybe(name);
    if (!f || f.isReadOnly()) continue;
    if (f instanceof PDFTextField) {
      const max = f.getMaxLength();
      f.setText(max !== undefined ? value.slice(0, max) : value);
    } else if (f instanceof PDFCheckBox) {
      if (value === "true") f.check();
      else f.uncheck();
    } else if (f instanceof PDFRadioGroup) {
      if (value && f.getOptions().includes(value)) f.select(value);
      else if (!value) f.clear();
    } else if (f instanceof PDFDropdown) {
      if (value) f.select(value, f.isEditable());
      else f.clear();
    } else if (f instanceof PDFOptionList) {
      const picked = value.split("\n").filter((v) => f.getOptions().includes(v));
      if (picked.length) f.select(picked);
      else f.clear();
    }
  }
  if (flatten) form.flatten();
  return saveDoc(doc);
}
