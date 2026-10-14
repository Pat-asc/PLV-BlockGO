import React, { useEffect, useMemo } from "react";

const YEAR_ORDER = ["1st Year", "2nd Year", "3rd Year", "4th Year"];

const YearTabs = ({ activeTab, setActiveTab, sections, className = "" }) => {
  const activeSections = useMemo(() => Object.values(sections || {}), [sections]);
  const totalSections = activeSections.length;
  const tabData = useMemo(() => {
    const years = [...new Set(activeSections.map((section) => section.year).filter(Boolean))];
    years.sort((left, right) => {
      const leftIndex = YEAR_ORDER.indexOf(left);
      const rightIndex = YEAR_ORDER.indexOf(right);
      if (leftIndex === -1 || rightIndex === -1) return left.localeCompare(right);
      return leftIndex - rightIndex;
    });
    return years.map((label) => {
      const count = activeSections.filter((section) => section.year === label).length;
      return { label, count, progress: totalSections > 0 ? (count / totalSections) * 100 : 0 };
    });
  }, [activeSections, totalSections]);

  useEffect(() => {
    const availableYears = tabData.map((tab) => tab.label);
    if (!availableYears.length) {
      if (activeTab) setActiveTab("");
    } else if (!availableYears.includes(activeTab)) {
      setActiveTab(availableYears[0]);
    }
  }, [activeTab, setActiveTab, tabData]);

  return (
    <div role="tablist" aria-label="Academic year filters" className={`flex w-full min-w-0 flex-wrap items-center gap-2 py-2 ${className}`}>
      {tabData.map((tab) => (
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === tab.label}
          key={tab.label}
          onClick={() => setActiveTab(tab.label)}
          className={`w-full min-w-0 rounded-xl border px-3 py-2 text-left shadow-sm transition-colors sm:w-auto sm:min-w-[132px] ${
  activeTab === tab.label
    ? "border-[#003366] bg-[#003366] text-white"
    : "border-slate-200 bg-white text-slate-800 hover:border-[#003366] hover:bg-slate-50"
}`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-bold">{tab.label}</span>
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
            activeTab === tab.label
           ? "bg-yellow-400 text-[#003366]"
            : "bg-slate-100 text-slate-700"
         }`}
            >  
              {tab.count}
            </span>
          </div>

          <div className="mt-1.5 h-1 w-full rounded-full bg-slate-200">
            <div
              className="h-1 rounded-full bg-yellow-400"
              style={{ width: `${tab.progress}%` }}
            />
          </div>
        </button>
      ))}
    </div>
  );
};

export default YearTabs;
