import React from "react";

function ChairpersonOverview({ metrics }) {
  const cards = [
    {
      title: "Faculty in Department",
      value: metrics.totalFaculty,
      subtitle: "Faculty members under chairperson monitoring",
    },
    {
      title: "Sections for Review",
      value: metrics.totalSections,
      subtitle: "Assigned sections awaiting monitoring or review",
    },
    {
      title: "Submitted Sections",
      value: metrics.submittedSections,
      subtitle: "Faculty submissions waiting for chairperson review",
    },
    {
      title: "Returned Sections",
      value: metrics.returnedSections,
      subtitle: "Sections sent back to faculty for correction",
    },
    {
      title: "Approved Sections",
      value: metrics.approvedSections,
      subtitle: "Sections approved and awaiting finalization",
    },
    {
      title: "Finalized Sections",
      value: metrics.forwardedSections,
      subtitle: "Sections finalized and verified on the ledger",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
      {cards.map((card) => (
        <div
          key={card.title}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <p className="text-xs font-semibold text-slate-500 sm:text-sm">{card.title}</p>
          <h3 className="mt-1 text-2xl font-bold text-[#003366] sm:text-3xl">{card.value}</h3>
          <p className="mt-1 hidden text-xs text-slate-400 sm:block">{card.subtitle}</p>
        </div>
      ))}
    </div>
  );
}

export default ChairpersonOverview;
