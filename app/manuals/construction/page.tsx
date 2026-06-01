import { ManualPage } from "@/components/imme/manual-page";

export const metadata = { title: "Construction Management Manual" };

export default function ConstructionManagementManualPage() {
  return (
    <ManualPage
      manualId="construction"
      toc={[
        { code: "1", title: "Contract administration", items: [
          { code: "1.1", title: "Contract types & conditions" },
          { code: "1.2", title: "Variations, claims & disputes" },
        ]},
        { code: "2", title: "Supervision", items: [
          { code: "2.1", title: "Inspection regime" },
          { code: "2.2", title: "Responsible supervision" },
        ]},
        { code: "3", title: "Specifications", items: [
          { code: "3.1", title: "Earthworks" },
          { code: "3.2", title: "Pavement" },
          { code: "3.3", title: "Drainage" },
          { code: "3.4", title: "Structures" },
          { code: "3.5", title: "Tunnel" },
          { code: "3.6", title: "Quality control" },
        ]},
      ]}
      description={
        <>
          <p>
            The Construction Management Manual prescribes contract administration, supervision, and technical
            specifications for expressway construction. It is the day-to-day reference for the Engineer&apos;s
            representative and contractor staff.
          </p>
          <p>
            Specifications are organized by work package (earthworks, drainage, pavement, structures, tunnels) with
            consistent acceptance and QC procedures across all packages.
          </p>
        </>
      }
      whyUganda={
        <>
          <p>
            Expressway-grade quality control on tunnels, structures, and pavement requires procedures more rigorous
            than general expressway works. Localizing these for Uganda reduces re-work and contract disputes during
            major projects such as KEE expansion.
          </p>
        </>
      }
    />
  );
}
