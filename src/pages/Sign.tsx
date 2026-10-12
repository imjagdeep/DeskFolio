import { Empty, PageHeader } from "../components/Common";
import { SignIcon } from "../components/Icons";

// Placeholder: this tool arrives in a later milestone.
export function Sign() {
  return (
    <div className="page">
      <PageHeader title="Fill & Sign" subtitle="Fill forms, sign and add text" />
      <Empty Icon={SignIcon} title="Coming soon" text="This tool is being built." />
    </div>
  );
}
