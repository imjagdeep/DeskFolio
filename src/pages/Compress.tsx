import { Empty, PageHeader } from "../components/Common";
import { CompressIcon } from "../components/Icons";

// Placeholder: this tool arrives in a later milestone.
export function Compress() {
  return (
    <div className="page">
      <PageHeader title="Compress" subtitle="Make a PDF smaller" />
      <Empty Icon={CompressIcon} title="Coming soon" text="This tool is being built." />
    </div>
  );
}
