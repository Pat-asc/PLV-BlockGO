import React from "react";
import plvlogo from "../../assets/plvlogo.png";
import SettingsMenu from "../shared/SettingsMenu";

const stripRolePrefix = (value = "") =>
  String(value)
    .replace(
      /^(prof\.?|mr\.?|ms\.?|mrs\.?|dept\.?\s*admin|department\s*admin|registrar|faculty)\s+/i,
      ""
    )
    .trim();

const FacultyHeader = ({ facultyData, totalSections, onLogout }) => {
  const rawName = (
    facultyData?.fullName ||
    `${facultyData?.firstName || ""} ${facultyData?.lastName || ""}`.trim() ||
    facultyData?.name ||
    facultyData?.email ||
    "Faculty"
  ).trim();

  const facultyName = stripRolePrefix(rawName) || "Faculty";
  const classification =
    facultyData?.Classification || facultyData?.facultyType || "Not set";
  const department = facultyData?.department || "No department assigned";
  const semester = facultyData?.semester || "2nd Semester";

  return (
    <div className="w-full">
      <header
        className="w-full border-b-2 border-yellow-400 bg-[#001b55] shadow-sm"
        style={{ backgroundImage: "linear-gradient(118deg, transparent 0 48%, rgba(10,48,122,.72) 48.2% 62%, transparent 62.2%), linear-gradient(142deg, transparent 0 68%, rgba(0,43,112,.85) 68.2% 83%, transparent 83.2%), linear-gradient(105deg, #00113f 0%, #002469 54%, #001748 100%)" }}
      >
        <div className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10">
              <img
                src={plvlogo}
                alt="PLV Logo"
                className="h-10 w-10 object-contain"
              />
            </div>

            <div className="leading-tight">
              <p className="text-xs font-medium uppercase tracking-wide text-white/70 sm:text-sm sm:normal-case sm:tracking-normal">Faculty Portal</p>
              <h1 className="truncate text-base font-bold text-white sm:text-xl">
                Welcome, {facultyName}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden rounded-xl bg-white/10 px-4 py-2 text-right md:block">
              <p className="text-xs text-white/70">Semester</p>
              <p className="text-sm font-semibold text-white">{semester}</p>
            </div>

            <SettingsMenu />

            <button
              type="button"
              onClick={onLogout}
              className="h-10 rounded-lg border border-yellow-400 bg-transparent px-3 text-sm font-semibold text-yellow-400 transition hover:bg-yellow-400 hover:text-[#003366] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#001b55] sm:px-4"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="mt-4 px-4 md:px-6">
        <div className="rounded-xl border border-blue-900/10 bg-[#003366] p-4 text-white shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-bold leading-tight md:text-xl">
                Prof. {facultyName}
              </h2>
              <p className="mt-1 text-sm text-white/80">{department}</p>
            </div>

            <div className="flex flex-wrap gap-3 md:gap-4">
              <div className="min-w-[110px] rounded-lg bg-white/10 px-3 py-2 text-center">
                <span className="block text-xs">Sections</span>
                <div className="text-lg font-bold">{totalSections ?? 0}</div>
              </div>

              <div className="min-w-[130px] rounded-lg bg-yellow-400 px-3 py-2 text-center font-bold text-[#003366]">
                <span className="block text-xs">Classification</span>
                <div className="text-lg">{classification}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FacultyHeader;
