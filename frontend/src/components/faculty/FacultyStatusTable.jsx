import React, { useMemo, useState } from "react";
import StatusBadge from "../shared/StatusBadge";

const PRIORITY_STANDINGS = new Set([
  "d",
  "dropped",
  "ud",
  "unofficially_dropped",
  "unofficially dropped",
  "w",
  "withdrawn",
  "inc",
  "incomplete",
]);

const normalizePriorityStanding = (value = "") => String(value || "").trim().toLowerCase();

const getSectionPrioritySummary = (section = {}) => {
  const grades = Object.values(section.grades || {});

  return grades.reduce(
    (acc, grade) => {
      const standing = normalizePriorityStanding(grade?.standing);

      if (grade?.flagged) acc.flagged += 1;
      if (standing === "d" || standing === "dropped") acc.d += 1;
      if (standing === "ud" || standing === "unofficially_dropped" || standing === "unofficially dropped") acc.ud += 1;
      if (standing === "w" || standing === "withdrawn") acc.w += 1;
      if (standing === "inc" || standing === "incomplete") acc.inc += 1;

      return acc;
    },
    { flagged: 0, d: 0, ud: 0, w: 0, inc: 0 }
  );
};

const getSectionPriorityScore = (section = {}) => {
  const summary = getSectionPrioritySummary(section);
  return summary.flagged + summary.d + summary.ud + summary.w + summary.inc;
};

const hasPriorityReviewItems = (section = {}) =>
  getSectionPriorityScore(section) > 0 ||
  Object.values(section.grades || {}).some((grade) =>
    PRIORITY_STANDINGS.has(normalizePriorityStanding(grade?.standing))
  );

const buildPriorityLabel = (summary = {}) => {
  const parts = [];
  if (summary.flagged) parts.push(`${summary.flagged} flagged`);
  if (summary.d) parts.push(`${summary.d} D`);
  if (summary.ud) parts.push(`${summary.ud} UD`);
  if (summary.w) parts.push(`${summary.w} W`);
  if (summary.inc) parts.push(`${summary.inc} INC`);
  return parts.join(" • ");
};

const getWorkflowLabel = (status = "") => {
  const normalized = String(status || "").toLowerCase();

  if (normalized === "returned") return "Returned to Faculty";
  if (normalized === "approved") return "Ready to Finalize";
  if (normalized === "forwarded") return "Finalized";
  return "For Review";
};

const getWorkflowState = (sections = []) => {
  const statuses = sections.map((section) => String(section.reviewStatus || "").toLowerCase());

  if (statuses.some((status) => status === "forwarded")) return "forwarded";
  if (statuses.some((status) => status === "returned")) return "returned";
  if (statuses.some((status) => status === "approved")) return "approved";
  return "submitted";
};

const getAcademicSectionIdentity = (section = {}) => [
  section.academicSectionId || String(section.sectionName || "").replace(/\([^)]*\)/g, "").trim().toLowerCase(),
  String(section.schoolYear || "").trim().toLowerCase(),
  String(section.semester || "").trim().toLowerCase(),
].join("|");

const formatTrackingDate = (value) => {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString() : "Not available";
};

function FacultyStatusTable({
  rows,
  allRows = [],
  selectedReviewKey,
  onSelectSection,
  onViewIpfs,
  viewMode = "default",
  loadError = "",
}) {
  const [expandedFacultyId, setExpandedFacultyId] = useState(null);
  const facultyRows = useMemo(() => {
    const allSectionsByFaculty = new Map();
    const visibleSectionsByFaculty = new Map();

    allRows.forEach((row) => {
      const facultyKey = row.facultyId || row.facultyName || "unknown";
      const current = allSectionsByFaculty.get(facultyKey) || {
        facultyId: row.facultyId,
        facultyName: row.facultyName || row.facultyId || "Unknown Faculty",
        sections: [],
      };

      current.sections.push(row);
      allSectionsByFaculty.set(facultyKey, current);
    });

    rows.forEach((row) => {
      const facultyKey = row.facultyId || row.facultyName || "unknown";
      const current = visibleSectionsByFaculty.get(facultyKey) || {
        facultyId: row.facultyId,
        facultyName: row.facultyName || row.facultyId || "Unknown Faculty",
        sections: [],
      };

      current.sections.push(row);
      visibleSectionsByFaculty.set(facultyKey, current);
    });

    return Array.from(visibleSectionsByFaculty.values())
      .map((faculty) => {
        const allFacultySections =
          allSectionsByFaculty.get(faculty.facultyId || faculty.facultyName)?.sections || [];
        const uniqueAssignedSections = new Set(allFacultySections.map(getAcademicSectionIdentity));
        const uniqueSubmittedSections = new Set(allFacultySections
          .filter((section) => section.reviewStatus && section.reviewStatus !== "pending")
          .map(getAcademicSectionIdentity));
        const sectionsWithPriority = faculty.sections.map((section) => {
          const prioritySummary = getSectionPrioritySummary(section);
          return {
            ...section,
            prioritySummary,
            needsPriorityReview: hasPriorityReviewItems(section),
            priorityScore: getSectionPriorityScore(section),
          };
        });
        const facultyPriorityCount = sectionsWithPriority.filter(
          (section) => section.needsPriorityReview
        ).length;

        return {
          ...faculty,
          sections: [...sectionsWithPriority].sort((left, right) =>
            right.priorityScore - left.priorityScore ||
            String(left.sectionName || "").localeCompare(String(right.sectionName || ""))
          ),
          totalAssignedSections: uniqueAssignedSections.size,
          submittedSections: uniqueSubmittedSections.size,
          workflowState: getWorkflowState(faculty.sections),
          facultyPriorityCount,
        };
      })
      .sort((left, right) =>
        right.facultyPriorityCount - left.facultyPriorityCount ||
        String(left.facultyName || "").localeCompare(String(right.facultyName || ""))
      );
  }, [allRows, rows]);

  if (viewMode === "forwarded") {
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <h3 className="text-xl font-bold text-[#003366]">Finalized Grades</h3>
          <p className="mt-1 text-sm text-slate-500">Current encoding season and active assignment cycles only.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1050px] w-full">
            <thead><tr className="bg-[#003366] text-white">
              {['Faculty', 'Subject', 'Section', 'School Year', 'Semester', 'Term', 'Finalized At', 'Finalized By', 'Status', 'Action'].map((label) =>
                <th key={label} className="px-4 py-3 text-left text-xs font-bold">{label}</th>)}
            </tr></thead>
            <tbody>{loadError ? (
              <tr><td colSpan="10" role="alert" className="px-6 py-10 text-center text-sm font-medium text-red-700">{loadError}</td></tr>
            ) : rows.length ? rows.map((section) => (
              <tr key={section.reviewKey} className="border-b border-slate-200">
                <td className="px-4 py-3 text-sm font-semibold">{section.facultyName}</td>
                <td className="px-4 py-3 text-sm">{section.subjectCode}</td>
                <td className="px-4 py-3 text-sm">{section.sectionName}</td>
                <td className="px-4 py-3 text-sm">{section.schoolYear}</td>
                <td className="px-4 py-3 text-sm">{section.semester}</td>
                <td className="px-4 py-3 text-sm capitalize">{section.term}</td>
                <td className="px-4 py-3 text-sm">{formatTrackingDate(section.finalizedAt)}</td>
                <td className="px-4 py-3 text-sm">{section.finalizedBy || 'Chairperson'}</td>
                <td className="px-4 py-3"><StatusBadge status="Finalized" /></td>
                <td className="px-4 py-3"><button type="button" onClick={() => onSelectSection?.(section)} className="rounded-lg bg-[#003366] px-3 py-2 text-xs font-semibold text-white">View Details</button></td>
              </tr>
            )) : <tr><td colSpan="10" className="px-6 py-10 text-center text-sm text-slate-500">No finalized submissions exist in the current encoding season.</td></tr>}</tbody>
          </table>
        </div>
      </div>
    );
  }

  if (viewMode !== "default") {
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <h3 className="text-xl font-bold text-[#003366]">{viewMode === "approved" ? "Finalize Queue" : viewMode === "returned" ? "Returned Sections" : "Faculty For Review"}</h3>
          <p className="mt-1 text-sm text-slate-500">{viewMode === "approved" ? "Approved submissions ready for final ledger processing." : viewMode === "returned" ? "Submissions sent back to faculty for correction." : "Submitted sections waiting for chairperson review."}</p>
          
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-[#003366] text-white">
                <th className="px-6 py-4 text-left text-sm font-bold">Faculty</th>
                <th className="px-6 py-4 text-left text-sm font-bold">Encoding</th>
                <th className="px-6 py-4 text-left text-sm font-bold">Workflow State</th>
                <th className="px-6 py-4 text-left text-sm font-bold">Action</th>
              </tr>
            </thead>
            <tbody>
              {facultyRows.length > 0 ? (
                facultyRows.flatMap((faculty) => {
                  const rowsForFaculty = [
                    <tr key={faculty.facultyId} className="border-b border-slate-200 align-top">
                      <td className="px-6 py-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900">{faculty.facultyName}</p>
                          {faculty.facultyPriorityCount > 0 ? (
                            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700">
                              {faculty.facultyPriorityCount} priority section{faculty.facultyPriorityCount > 1 ? "s" : ""}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
                          {faculty.submittedSections}/{faculty.totalAssignedSections || faculty.sections.length} Section Encoded
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        <StatusBadge status={faculty.workflowState} label={getWorkflowLabel(faculty.workflowState)} />
                      </td>
                      <td className="px-6 py-5">
                        <button
                          type="button"
                          onClick={() => {
                            const isClosingCurrentFaculty = expandedFacultyId === faculty.facultyId;
                            setExpandedFacultyId(isClosingCurrentFaculty ? null : faculty.facultyId);
                            onSelectSection?.(null);
                          }}
                          className="rounded-lg bg-[#003366] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#00264d]"
                        >
                          Review Encoded
                        </button>
                      </td>
                    </tr>,
                  ];

                  if (expandedFacultyId !== faculty.facultyId) {
                    return rowsForFaculty;
                  }

                  rowsForFaculty.push(
                    <tr key={`${faculty.facultyId}-sections`} className="border-b border-slate-200 bg-slate-50">
                      <td colSpan="4" className="px-6 py-5">
                        <div className="flex flex-col gap-3">
                          {faculty.sections.map((section) => {
                            const isActive = selectedReviewKey === section.reviewKey;
                            const priorityLabel = buildPriorityLabel(section.prioritySummary);

                            return (
                              <div
                                key={section.reviewKey}
                                className={`flex w-full items-center justify-between gap-4 rounded-2xl border px-5 py-4 ${
                                  isActive
                                    ? "border-[#003366] bg-blue-50"
                                    : section.needsPriorityReview
                                    ? "border-red-200 bg-red-50"
                                    : "border-slate-200 bg-white"
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-slate-800">
                                    {section.sectionName}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {section.subjectCode || 'Unknown subject'} / {section.schoolYear || 'Unknown year'} / {section.semester || 'Unknown semester'} / {String(section.term || 'midterm').toUpperCase()}
                                  </p>
                                  {section.needsPriorityReview ? (
                                    <p className="mt-1 text-xs font-medium text-red-700">
                                      Check first{priorityLabel ? ` • ${priorityLabel}` : ""}
                                    </p>
                                  ) : null}
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onSelectSection?.(
                                      isActive ? null : section
                                    )
                                  }
                                  className={`rounded-lg px-3 py-2 text-sm font-semibold text-white transition ${
                                    section.needsPriorityReview
                                      ? "bg-red-600 hover:bg-red-700"
                                      : "bg-[#003366] hover:bg-[#00264d]"
                                  }`}
                                >
                                  Review Section
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );

                  return rowsForFaculty;
                })
              ) : (
                <tr>
                  <td colSpan="4" className="px-6 py-10 text-center text-sm text-slate-500">
                    {viewMode === 'returned' ? 'No returned sections require correction.' : viewMode === 'approved' ? 'No approved sections are ready to finalize.' : 'No faculty submissions found for review.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
        No faculty sections found for this department yet.
      </div>
    </div>
  );
}

export default FacultyStatusTable;
