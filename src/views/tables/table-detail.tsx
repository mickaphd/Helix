// What a table type offers, as New Table shows it beside the list: its analyses and graphs,
// read from their own lists so it always says what Helix does.
import type * as React from "react";
import { ChartLineIcon, SigmaIcon } from "@phosphor-icons/react";
import type { TableType } from "../../store/types";
import type { SelectorOption } from "../../components/universal-modal";
import { ANALYSIS_OPTIONS_BY_TABLE } from "../analyses";
import { GRAPH_OPTIONS_BY_TABLE } from "../graphs";

export function TableDetail({ type }: { type: TableType }) {
  return (
    <div className="flex flex-col gap-3">
      <Offers title="Analyses" icon={<SigmaIcon />} options={ANALYSIS_OPTIONS_BY_TABLE[type]} />
      <Offers title="Graphs" icon={<ChartLineIcon />} options={GRAPH_OPTIONS_BY_TABLE[type]} />
    </div>
  );
}

function Offers({ title, icon, options }: { title: string; icon: React.ReactNode; options: SelectorOption[] }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="flex items-center gap-1.5 text-strong [&_svg]:size-4 [&_svg]:text-secondary">
        {icon}
        {title}
      </h3>
      <ul className="list-disc pl-5 text-regular marker:text-secondary">
        {options.map((o) => (
          <li key={o.value}>{o.label}</li>
        ))}
      </ul>
    </div>
  );
}
