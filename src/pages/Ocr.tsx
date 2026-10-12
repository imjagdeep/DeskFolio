import { Empty, PageHeader } from "../components/Common";
import { OcrIcon } from "../components/Icons";

// Placeholder: this tool arrives in a later milestone.
export function Ocr() {
  return (
    <div className="page">
      <PageHeader title="OCR" subtitle="Make scanned PDFs searchable" />
      <Empty Icon={OcrIcon} title="Coming soon" text="This tool is being built." />
    </div>
  );
}
