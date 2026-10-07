import React from "react";

const icons = {
  dashboard: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M7 16v-4m5 4V8m5 8v-6" /></>,
  sectioning: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2" /></>,
  assignment: <><path d="m2 8 10-5 10 5-10 5zM6 10v7l6 3 6-3v-7M22 8v7" /></>,
  curriculum: <><path d="M12 5v16M3 3h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3z" /></>,
  forReview: <><path d="M14 3H5v18h14V8zM14 3v5h5m-11 6 3 3 5-6" /></>,
  returned: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 6 6v4" /></>,
  approved: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  forwarded: <><path d="M20 6 9 17l-5-5" /><path d="M4 3h16v18H4z" /></>,
};

function ChairpersonSidebar({ activeTab, setActiveTab }) {
  const menuItems = [
    { id: "dashboard", label: "Encoding Monitoring" },
    { id: "sectioning", label: "Department Sections" },
    { id: "assignment", label: "Faculty Assignments" },
    { id: "curriculum", label: "Curriculum Builder" },
    { id: "forReview", label: "Grade Review" },
    { id: "returned", label: "Returned Grades" },
    { id: "approved", label: "Finalize Grades" },
    { id: "forwarded", label: "Finalized Grades" },
  ];

  return (
    <aside className="w-full self-start rounded-xl border border-slate-200 bg-white p-2 shadow-sm lg:sticky lg:top-6 lg:w-[250px] lg:shrink-0 lg:p-2.5">
      <nav aria-label="Chairperson navigation" className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {menuItems.map((item) => {
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => setActiveTab(item.id)}
              className={`group relative flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 lg:min-h-12 lg:w-full lg:gap-3 ${
                isActive
                  ? "bg-[#003366] text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-[#003366]"
              }`}
            >
              {isActive && <span aria-hidden="true" className="absolute bottom-2 left-0 top-2 w-1 rounded-r-full bg-yellow-400" />}
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${isActive ? "bg-white/10 text-yellow-400" : "bg-slate-100 text-slate-500 group-hover:bg-blue-50 group-hover:text-[#003366]"}`}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">{icons[item.id]}</svg>
              </span>
              <span className={isActive ? "font-semibold" : ""}>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

export default ChairpersonSidebar;
