import { Empty, PageHeader } from "../components/Common";
import { ConvertIcon } from "../components/Icons";

// Placeholder: this tool arrives in a later milestone.
export function Convert() {
  return (
    <div className="page">
      <PageHeader title="Convert" subtitle="To and from Word, Excel, text and images" />
      <Empty Icon={ConvertIcon} title="Coming soon" text="This tool is being built." />
    </div>
  );
}
