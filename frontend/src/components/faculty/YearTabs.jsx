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
    <div className={`flex min-w-0 gap-4 overflow-x-auto py-2 ${className}`}>
      {tabData.map((tab) => (
        <div
          key={tab.label}
          onClick={() => setActiveTab(tab.label)}
         className={`min-w-[150px] p-4 rounded-2xl cursor-pointer shadow-md transition-all duration-300 transform ${
  activeTab === tab.label
    ? "bg-[#003366] text-white scale-105"
    : "bg-white hover:scale-105 hover:-translate-y-1 hover:shadow-xl"
}`}
        >
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-bold">{tab.label}</span>
            <span className={`flex items-center justify-center text-xs font-bold w-6 h-6 rounded-full ${
            activeTab === tab.label
           ? "bg-yellow-400 text-[#003366]"
            : "bg-slate-100 text-slate-700"
         }`}
            >  
              {tab.count}
            </span>
          </div>

          <div className="w-full h-1 bg-slate-200 rounded-full">
            <div
              className="h-1 bg-yellow-400 rounded-full"
              style={{ width: `${tab.progress}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default YearTabs;
