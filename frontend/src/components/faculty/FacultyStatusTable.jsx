import React, { useEffect, useMemo, useState } from "react";
import Modal from "../../services/Modal";
import StatusBadge from "../shared/StatusBadge";

const normalizeStanding = (value = "") => String(value || "").trim().toLowerCase();

const getPrioritySummary = (section = {}) => Object.values(section.grades || {}).reduce(
  (summary, grade) => {
    const standing = normalizeStanding(grade?.standing);
    if (grade?.flagged) summary.flagged += 1;
    if (standing === "d" || standing === "dropped") summary.d += 1;
    if (["ud", "unofficially_dropped", "unofficially dropped"].includes(standing)) summary.ud += 1;
    if (standing === "w" || standing === "withdrawn") summary.w += 1;
    if (standing === "inc" || standing === "incomplete") summary.inc += 1;
    return summary;
  },
  { flagged: 0, d: 0, ud: 0, w: 0, inc: 0 }
);

const getPriorityScore = (summary) => Object.values(summary).reduce((total, count) => total + count, 0);

const buildPriorityLabel = (summary) => {
  const parts = [];
  if (summary.flagged) parts.push(`${summary.flagged} flagged`);
  if (summary.d) parts.push(`${summary.d} D`);
  if (summary.ud) parts.push(`${summary.ud} UD`);
  if (summary.w) parts.push(`${summary.w} W`);
  if (summary.inc) parts.push(`${summary.inc} INC`);
  return parts.join(" • ");
};

const getWorkflowLabel = (section = {}) => {
  if (section.reviewStatus === "returned") return "Returned to Faculty";
  if (section.reviewStatus === "approved" && section.sentToRegistrar) return "Sent to Registrar";
  if (section.reviewStatus === "approved") return "Ready for Registrar";
  if (section.reviewStatus === "forwarded") return "Finalized";
  return "For Review";
};

const getViewCopy = (viewMode) => {
  if (viewMode === "returned") return {
    title: "Returned Grades",
    description: "Review sections already returned to Faculty and their correction remarks.",
    empty: "No returned sections require correction.",
    action: "View Review",
  };
  if (viewMode === "approved") return {
    title: "Approved Grades",
    description: "Chairperson-approved submissions and their Registrar handoff state.",
    empty: "No approved sections are waiting for Registrar handoff.",
    action: "View Review",
  };
  if (viewMode === "forwarded") return {
    title: "Finalized Grades",
    description: "Current encoding season and active assignment cycles only.",
    empty: "No finalized submissions exist in the current encoding season.",
    action: "View Details",
  };
  return {
    title: "Grade Review",
    description: "Submitted sections waiting for Chairperson review.",
    empty: "No Faculty submissions found for review.",
    action: "Review Grades",
  };
};

const formatTrackingDate = (value) => {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString() : "Not available";
};

function FacultyStatusTable({ rows, selectedReviewKey, onSelectSection, viewMode = "default", loadError = "" }) {
  const copy = getViewCopy(viewMode);
  const [selectedFacultyKey, setSelectedFacultyKey] = useState("");
  const workloadRows = useMemo(() => rows
    .map((section) => {
      const prioritySummary = getPrioritySummary(section);
      return { ...section, prioritySummary, priorityScore: getPriorityScore(prioritySummary) };
    })
    .sort((left, right) => right.priorityScore - left.priorityScore ||
      String(left.facultyName || "").localeCompare(String(right.facultyName || "")) ||
      String(left.sectionName || "").localeCompare(String(right.sectionName || ""))), [rows]);
  const facultyGroups = useMemo(() => {
    const groups = new Map();
    workloadRows.forEach((section) => {
      const facultyKey = String(
        section.facultyId || section.facultyUserId || section.facultyEmail || section.email || `review:${section.reviewKey}`
      ).trim().toLowerCase();
      if (!groups.has(facultyKey)) {
        groups.set(facultyKey, {
          facultyKey,
          facultyName: section.facultyName || section.facultyEmail || "Assigned faculty",
          sections: [],
        });
      }
      groups.get(facultyKey).sections.push(section);
    });
    return [...groups.values()];
  }, [workloadRows]);
  const selectedFaculty = facultyGroups.find((group) => group.facultyKey === selectedFacultyKey) || null;

  useEffect(() => {
    if (selectedFacultyKey && !facultyGroups.some((group) => group.facultyKey === selectedFacultyKey)) {
      setSelectedFacultyKey("");
    }
  }, [facultyGroups, selectedFacultyKey]);

  const openSection = (section) => {
    setSelectedFacultyKey("");
    onSelectSection?.(rows.find((row) => row.reviewKey === section.reviewKey) || section);
  };

  if (viewMode === "default") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No Faculty sections found for this department yet.
        </div>
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <header className="border-b border-slate-200 px-5 py-5 dark:border-slate-700 sm:px-6">
        <h2 className="text-xl font-bold text-[#003366] dark:text-sky-300">{copy.title}</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{copy.description}</p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="bg-[#003366] text-white dark:bg-slate-800">
              {['Faculty', 'Sections', 'Action'].map((label) => (
                <th key={label} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loadError ? (
              <tr><td colSpan="3" role="alert" className="px-6 py-10 text-center text-sm font-medium text-red-700 dark:text-red-300">{loadError}</td></tr>
            ) : facultyGroups.length ? facultyGroups.map((facultyGroup) => (
              <tr key={facultyGroup.facultyKey} data-faculty-group={facultyGroup.facultyKey} className="border-b border-slate-200 transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/70">
                <td className="px-4 py-4 text-sm font-bold text-slate-900 dark:text-slate-100">{facultyGroup.facultyName}</td>
                <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-300">{facultyGroup.sections.length} section{facultyGroup.sections.length === 1 ? '' : 's'}</td>
                <td className="px-4 py-4">
                  <button type="button" onClick={() => setSelectedFacultyKey(facultyGroup.facultyKey)} className="rounded-lg bg-[#003366] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#00264d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:bg-sky-700 dark:hover:bg-sky-600">
                    View Sections
                  </button>
                </td>
              </tr>
            )) : (
              <tr><td colSpan="3" className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">{copy.empty}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={Boolean(selectedFaculty)}
        onClose={() => setSelectedFacultyKey("")}
        title={`${selectedFaculty?.facultyName || "Faculty"} — Encoded Sections`}
        description={`${selectedFaculty?.sections.length || 0} applicable section${selectedFaculty?.sections.length === 1 ? "" : "s"} in ${copy.title}.`}
        panelClassName="flex max-h-[90vh] max-w-6xl flex-col overflow-hidden p-4 sm:p-6"
        bodyClassName="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="overflow-x-auto" data-testid="faculty-sections-scroll-area">
          <table className="w-full min-w-[920px] text-left">
            <thead className="sticky top-0 z-10 bg-[#003366] text-white dark:bg-slate-800">
              <tr>
                {['Section', 'Subject', 'School Year', 'Semester', 'Term', 'Workflow State', 'Action'].map((label) => (
                  <th key={label} className="px-4 py-3 text-xs font-bold uppercase tracking-wide">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(selectedFaculty?.sections || []).map((section) => {
                const priorityLabel = buildPriorityLabel(section.prioritySummary);
                const selected = selectedReviewKey === section.reviewKey;
                return (
                  <tr key={section.reviewKey} className={`border-b border-slate-200 align-top dark:border-slate-700 ${selected ? 'bg-blue-50 dark:bg-sky-950/30' : section.priorityScore ? 'bg-red-50/60 dark:bg-red-950/20' : 'dark:bg-slate-900'}`}>
                    <td className="px-4 py-4 text-sm text-slate-700 dark:text-slate-300">{section.sectionName}</td>
                    <td className="px-4 py-4 text-sm text-slate-700 dark:text-slate-300">
                      <span className="font-semibold">{section.subjectCode || 'Unknown subject'}</span>
                      {section.subjectTitle ? <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{section.subjectTitle}</span> : null}
                      {priorityLabel ? <span className="mt-1 block text-xs font-semibold text-red-700 dark:text-red-300">Check first • {priorityLabel}</span> : null}
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-700 dark:text-slate-300">{section.schoolYear || 'Unknown'}</td>
                    <td className="px-4 py-4 text-sm text-slate-700 dark:text-slate-300">{section.semester || 'Unknown'}</td>
                    <td className="px-4 py-4 text-sm capitalize text-slate-700 dark:text-slate-300">{section.term || 'midterm'}</td>
                    <td className="px-4 py-4">
                      <StatusBadge status={section.sentToRegistrar ? 'forwarded' : section.reviewStatus} label={getWorkflowLabel(section)} />
                      {viewMode === 'forwarded' ? <span className="mt-2 block text-xs text-slate-500 dark:text-slate-400">{formatTrackingDate(section.finalizedAt)}<br />{section.finalizedBy || 'Registrar'}</span> : null}
                    </td>
                    <td className="px-4 py-4">
                      <button type="button" onClick={() => openSection(section)} className="rounded-lg bg-[#003366] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#00264d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:bg-sky-700 dark:hover:bg-sky-600">
                        {copy.action}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Modal>
    </section>
  );
}

export default FacultyStatusTable;
