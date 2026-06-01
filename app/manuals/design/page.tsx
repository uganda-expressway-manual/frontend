import { ManualPage } from "@/components/imme/manual-page";

export const metadata = { title: "Design Manual" };

export default function DesignManualPage() {
  return (
    <ManualPage
      manualId="design"
      toc={[
        { code: "1", title: "Geometric design", items: [
          { code: "1.1", title: "Alignment & cross-section" },
          { code: "1.2", title: "Interchanges & junctions" },
        ]},
        { code: "2", title: "Pavement design", items: [
          { code: "2.1", title: "Flexible pavement" },
          { code: "2.2", title: "Concrete pavement" },
        ]},
        { code: "3", title: "Structures", items: [
          { code: "3.1", title: "Bridges" },
          { code: "3.2", title: "Culverts & retaining structures" },
        ]},
        { code: "4", title: "Drainage & geotechnics" },
        { code: "5", title: "Tunnels & ITS" },
      ]}
      description={
        <>
          <p>
            The Design Manual codifies expressway-specific design rules — geometric, pavement, structural, drainage,
            geotechnical, and tunnel/ITS — so designers do not rely on adapted general-expressway documents.
          </p>
          <p>
            Each chapter begins with the Uganda regulatory context, then specifies design inputs, computation methods,
            and acceptance criteria, with worked examples and checklists.
          </p>
        </>
      }
      whyUganda={
        <>
          <p>
            Concrete pavement, tunnels, and detailed geotechnical procedures were previously under-specified for
            Ugandan expressway use. This manual closes those gaps with localized criteria and Ugandan case
            references.
          </p>
        </>
      }
    />
  );
}
