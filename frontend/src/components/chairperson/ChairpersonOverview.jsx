import React from "react";

function ChairpersonOverview({ metrics }) {
  const facultyValue = metrics.facultyLoading || metrics.facultyError ? "—" : metrics.totalFaculty;
  const cards = [
    {
      title: "Faculty in Department",
      value: facultyValue,
      subtitle: metrics.facultyError || (metrics.facultyLoading ? "Loading active Faculty accounts…" : "Faculty members under chairperson monitoring"),
    },
    {
      title: "Grade Review",
      value: metrics.submittedSections,
      subtitle: "Faculty submissions waiting for Registrar review",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
