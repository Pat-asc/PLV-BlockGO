import React, { useCallback, useEffect, useMemo, useState } from "react";
import FacultyLoading from "./FacultyLoading";
import { fetchApprovedFaculties, fetchCurriculums, fetchFacultyAssignmentOptions, assignFacultyLoadToBackend, fetchFacultyAccessControls, blockFaculty, unblockFaculty } from "../../services/api";
import { pushAssignmentsSharedState } from "../../utils/sharedClientState";
import { reconcileActiveAssignmentCache } from "../../utils/facultyAssignmentState";
import { buildFacultySchedule, DAY_OPTIONS, facultySchedulesOverlap, formatFacultySchedule, isValidScheduleRange, parseFacultySchedule } from "../../utils/facultySchedule";
import "./SubjectAssignment.css";
import BoundedSelect from "../shared/BoundedSelect";
import Modal from "../../services/Modal";

const nameOf = (person) => person?.fullname || person?.fullName || person?.name || person?.email || "";
const idOf = (person) => String(person?.id || person?.email || "");
const years = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
const terms = { FIRST: "1st Semester", SECOND: "2nd Semester", MIDYEAR: "Summer" };
const identity = (item) => [item.academicSectionId || `${item.program}|${item.sectionName}`, item.schoolYear, item.semester, item.subjectCode].join("|");
const scheduleIdentity = (facultyId, academicSectionId, schoolYear, semester, subjectCode) =>
  [facultyId, academicSectionId, schoolYear, semester, subjectCode]
    .map((value) => String(value || "").trim().toLowerCase())
    .join("|");
function Icon({ type }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{type === "search" ? <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></> : type === "book" ? <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/></> : type === "save" ? <><path d="M4 3h13l3 3v15H4zM8 3v6h8V3M8 21v-8h8v8"/></> : type === "cap" ? <><path d="m2 9 10-5 10 5-10 5zM6 12v5l6 3 6-3v-5M22 9v7"/></> : type === "upload" ? <><path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/></> : type === "trash" ? <><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></> : <><circle cx="12" cy="7" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3z"/></>}</svg>;
}
function Heading({ icon, title }) { return <div className="sa-heading"><span className="sa-icon"><Icon type={icon}/></span><div><h3>{title}</h3></div></div>; }

export default function AcademicAssignment({ chairpersonDepartment = "" }) {
  const [faculty, setFaculty] = useState([]);
  const [curricula, setCurricula] = useState([]);
  const [assignmentOptions, setAssignmentOptions] = useState({ sections: [], subjects: [], enrollmentPeriods: [], schoolYears: [], assignments: [] });
  const [loading, setLoading] = useState(true);
  const [professor, setProfessor] = useState("");
  const [lookup, setLookup] = useState("");
  const [professorListOpen, setProfessorListOpen] = useState(false);
  const [program, setProgram] = useState("");
  const [year, setYear] = useState("3rd Year");
  const [term, setTerm] = useState("SECOND");
  const [academicSectionFilter, setAcademicSectionFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [subjectCode, setSubjectCode] = useState("");
  const [mode, setMode] = useState("manual");
  const [draft, setDraft] = useState([]);
  const [saved, setSaved] = useState([]);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [accessControls, setAccessControls] = useState([]);
  const [blockModalOpen, setBlockModalOpen] = useState(false);
  const [blockTarget, setBlockTarget] = useState(null);
  const [blockReason, setBlockReason] = useState("");
  const [blockError, setBlockError] = useState("");
  const [updatingAccess, setUpdatingAccess] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState("assignments");
  const [facultyAccessSearch, setFacultyAccessSearch] = useState("");
  const [facultyAccessStatus, setFacultyAccessStatus] = useState("all");

  const [schedules, setSchedules] = useState({});
  const applyAssignmentOptions = useCallback((nextOptions) => {
    setAssignmentOptions(nextOptions);
    if (nextOptions.activeAcademicPeriod?.semester) {
      setTerm(nextOptions.activeAcademicPeriod.semester);
    }
    const reconciled = reconcileActiveAssignmentCache(nextOptions, chairpersonDepartment);
    setSaved(reconciled.assignments);
    if (reconciled.changed) pushAssignmentsSharedState();
  }, [chairpersonDepartment]);

  const refreshAssignments = useCallback(async (confirmedAssignments = []) => {
    const fetchedOptions = await fetchFacultyAssignmentOptions(chairpersonDepartment);
    const nextOptions = fetchedOptions
      ? { ...fetchedOptions, assignments: [...(fetchedOptions.assignments || [])] }
      : { sections: [], subjects: [], enrollmentPeriods: [], schoolYears: [], assignments: [] };
    const returnedIds = new Set((nextOptions.assignments || []).map((item) => String(item.id)));
    const missingConfirmed = confirmedAssignments.filter((item) => !returnedIds.has(String(item.id)));
    if (missingConfirmed.length) nextOptions.assignments = [...(nextOptions.assignments || []), ...missingConfirmed];
    applyAssignmentOptions(nextOptions);
  }, [applyAssignmentOptions, chairpersonDepartment]);

  useEffect(() => {
    let active = true;
    Promise.allSettled([fetchApprovedFaculties(), fetchCurriculums(), fetchFacultyAssignmentOptions(chairpersonDepartment)]).then(([people, courses, options]) => {
      if (!active) return;
      if (people.status === "fulfilled") setFaculty(people.value.faculties || []);
      if (courses.status === "fulfilled") setCurricula(courses.value.data || []);
      if (options.status === "fulfilled") {
        const nextOptions = options.value || { sections: [], subjects: [], enrollmentPeriods: [], schoolYears: [], assignments: [] };
        applyAssignmentOptions(nextOptions);
      }
      if (people.status === "rejected" || courses.status === "rejected" || options.status === "rejected") setNotice("Some data could not be loaded. Refresh the page to retry.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [applyAssignmentOptions, chairpersonDepartment]);
  const refreshAccessControls = useCallback(() => fetchFacultyAccessControls()
    .then((response) => setAccessControls(response?.faculties || []))
    .catch(() => setNotice("Faculty access-control status could not be loaded.")), []);
  useEffect(() => { refreshAccessControls(); }, [refreshAccessControls]);
  useEffect(() => {
    const handleAcademicDataChanged = () => refreshAssignments().catch(() => setNotice("Current assignments could not be refreshed. Please try again."));
    window.addEventListener("blockgo:academic-data-changed", handleAcademicDataChanged);
    return () => window.removeEventListener("blockgo:academic-data-changed", handleAcademicDataChanged);
  }, [refreshAssignments]);
  const availablePrograms = useMemo(() => {
    const candidates = [
      assignmentOptions.program,
      ...(assignmentOptions.sections || []).map((item) => ({ code: item.programCode, name: item.department })),
    ].filter((item) => item?.code && item?.name);
    return candidates.filter((item, index, items) =>
      items.findIndex((candidate) => candidate.code === item.code) === index
    );
  }, [assignmentOptions]);
  useEffect(() => {
    if (availablePrograms.length && !availablePrograms.some((item) => item.code === program)) {
      setProgram(availablePrograms[0].code);
    }
  }, [availablePrograms, program]);
  useEffect(() => {
    const persistedSchedules = {};
    (assignmentOptions.assignments || []).forEach((item) => {
      const schedule = parseFacultySchedule(item.schedule, item.day);
      if (!schedule.day) return;
      persistedSchedules[scheduleIdentity(
        item.facultyUserId || item.facultyId,
        item.academicSectionId,
        item.schoolYear,
        item.semesterCode || item.semester,
        item.subjectCode
      )] = schedule;
    });
    setSchedules((current) => ({ ...persistedSchedules, ...current }));
  }, [assignmentOptions.assignments]);
  const departmentFaculty = faculty.filter((person) => (person.department || person.program) === chairpersonDepartment || (person.department || person.program) === program);
  const selectedProfessor = departmentFaculty.find((person) => idOf(person) === professor);
  const facultyAccessRows = useMemo(() => {
    const map = new Map();
    departmentFaculty.forEach((person) => {
      const uid = Number(person.id);
      const key = Number.isFinite(uid) && uid > 0 ? String(uid) : String(person.email || idOf(person));
      const ctrl = accessControls.find(
        (item) => String(item.facultyUserId) === String(person.id) || (person.email && String(item.email || "").toLowerCase() === String(person.email).toLowerCase())
      );
      map.set(key, {
        facultyUserId: ctrl?.facultyUserId ?? person.id,
        facultyId: ctrl?.facultyId || person.facultyId || String(person.id || "—"),
        fullName: nameOf(person) || ctrl?.fullName || "—",
        email: person.email || ctrl?.email || "—",
        department: person.department || person.program || ctrl?.department || chairpersonDepartment || "—",
        isBlocked: Boolean(ctrl?.isBlocked),
        accessStatus: ctrl?.isBlocked ? "Blocked" : "Active",
        reason: ctrl?.reason || "",
      });
    });
    accessControls.forEach((ctrl) => {
      const key = String(ctrl.facultyUserId || ctrl.email || "");
      if (!key || map.has(key)) return;
      map.set(key, {
        facultyUserId: ctrl.facultyUserId,
        facultyId: ctrl.facultyId || String(ctrl.facultyUserId || "—"),
        fullName: ctrl.fullName || ctrl.email || "—",
        email: ctrl.email || "—",
        department: ctrl.department || chairpersonDepartment || "—",
        isBlocked: Boolean(ctrl.isBlocked),
        accessStatus: ctrl.isBlocked ? "Blocked" : "Active",
        reason: ctrl.reason || "",
      });
    });
    return Array.from(map.values());
  }, [accessControls, chairpersonDepartment, departmentFaculty]);
  const filteredFacultyAccessRows = useMemo(() => {
    const queryText = facultyAccessSearch.trim().toLowerCase();
    return facultyAccessRows.filter((row) => {
      if (facultyAccessStatus === "active" && row.isBlocked) return false;
      if (facultyAccessStatus === "blocked" && !row.isBlocked) return false;
      if (!queryText) return true;
      return [row.fullName, row.facultyId, row.email, row.department]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(queryText));
    });
  }, [facultyAccessRows, facultyAccessSearch, facultyAccessStatus]);
  const programName = availablePrograms.find((item) => item.code === program)?.name || chairpersonDepartment || program;
  const curriculum = curricula.find((item) => item.programCode === program && item.status === "PUBLISHED");
  const canonicalSubjects = assignmentOptions.subjects?.length ? assignmentOptions.subjects : (curriculum?.subjects || []);
  const subjects = canonicalSubjects.filter((item) => Number(item.yearLevel) === years.indexOf(year) + 1 && item.semester === term);
  const visibleSubjects = subjects.filter((item) => `${item.subjectCode} ${item.subjectTitle}`.toLowerCase().includes(query.toLowerCase()));
  const subject = subjects.find((item) => item.subjectCode === subjectCode);
  const activeSchoolYear = assignmentOptions.activeAcademicPeriod?.schoolYear || "";
  const availableSchoolYears = activeSchoolYear
    ? [activeSchoolYear]
    : assignmentOptions.schoolYears?.length
    ? assignmentOptions.schoolYears
    : [...new Set((assignmentOptions.enrollmentPeriods || []).map((period) => period.schoolYear))];
  const activeSemester = assignmentOptions.activeAcademicPeriod?.semester || "";
  const activePeriodLabel = activeSchoolYear && activeSemester
    ? `${activeSchoolYear} · ${terms[activeSemester] || activeSemester}`
    : "Not configured";
  const semesterOptions = Object.entries(terms);
  const enrollmentPeriods = assignmentOptions.enrollmentPeriods || [];

  const allSections = (assignmentOptions.sections || []).flatMap((academicSection) => {
    const sectionPeriods = enrollmentPeriods.filter(
      (period) =>
        period.academicSectionId &&
        String(period.academicSectionId) === String(academicSection.id)
    );
    const periods = sectionPeriods.length
      ? sectionPeriods.map((period) => ({
          schoolYear: period.schoolYear,
          semesterCode: period.semester,
          semester:
            terms[period.semester] ||
            period.semesterDisplay ||
            period.semester,
          hasEnrollmentPeriod: true,
        }))
      : availableSchoolYears.map((schoolYear) => ({
          schoolYear,
          semesterCode: term,
          semester: terms[term],
          hasEnrollmentPeriod: false,
        }));

    return periods.map((period) => ({
      academicSectionId: academicSection.id,
      program: academicSection.department,
      yearLevel: years[Number(academicSection.yearLevel) - 1],
      section: `${academicSection.programCode} ${academicSection.section}`,
      schoolYear: period.schoolYear,
      semester: period.semester,
      semesterCode: period.semesterCode,
      hasEnrollmentPeriod: period.hasEnrollmentPeriod,
      periodMatchesActive:
        !!activeSchoolYear && !!activeSemester &&
        period.schoolYear === activeSchoolYear && period.semesterCode === activeSemester,
      students: [],
    }));
  });
  const eligibleSections = allSections.filter((item, index, items) =>
    item.periodMatchesActive && item.program === programName && item.yearLevel === year && item.semesterCode === term &&
    items.findIndex((other) =>
      String(other.academicSectionId) === String(item.academicSectionId) &&
      other.schoolYear === item.schoolYear && other.semesterCode === item.semesterCode
    ) === index
  );
  const sectionFilterOptions = eligibleSections.filter((item, index, items) =>
    items.findIndex((other) => String(other.academicSectionId) === String(item.academicSectionId)) === index
  );
  const sections = eligibleSections.filter((item) =>
    academicSectionFilter === "all" || String(item.academicSectionId) === academicSectionFilter
  );
  const savedRows = saved.filter((item) => String(item.facultyId) === professor);
  const professorDraft = draft.filter((item) => String(item.facultyId) === professor);
  const rows = [
    ...savedRows.map((item) => ({ ...item, assignmentState: "saved" })),
    ...professorDraft.map((item) => ({ ...item, assignmentState: "pending" })),
  ];
  const displayedRows = selectedProfessor
    ? rows
    : saved.map((item) => ({ ...item, assignmentState: "saved" }));
  const totalUnits = rows.reduce((sum, item) => sum + (Number(item.units) || 0), 0);
  const pendingUnits = professorDraft.reduce((sum, item) => sum + (Number(item.units) || 0), 0);
  const scheduleKeyFor = (section, facultyId = professor, selectedSubjectCode = subjectCode) => scheduleIdentity(
    facultyId,
    section.academicSectionId,
    section.schoolYear,
    section.semesterCode,
    selectedSubjectCode
  );
  const selectProfessor = (person) => { setProfessor(idOf(person)); setLookup(""); setProfessorListOpen(false); };
  const openBlockFacultyModal = (targetFaculty) => {
    setBlockTarget(targetFaculty);
    setBlockReason("");
    setBlockError("");
    setBlockModalOpen(true);
  };
  const updateFacultyAccess = async () => {
    const activeTarget = blockTarget;
    if (!activeTarget?.facultyUserId || updatingAccess) return;
    const trimmedReason = blockReason.trim();
    if (!activeTarget.isBlocked && !trimmedReason) {
      setBlockError("A reason is required before blocking Faculty academic access.");
      return;
    }
    if (!activeTarget.isBlocked && trimmedReason.length < 3) {
      setBlockError("Please enter a block reason of at least 3 characters.");
      return;
    }
    setUpdatingAccess(true);
    setBlockError("");
    try {
      if (activeTarget.isBlocked) await unblockFaculty(activeTarget.facultyUserId);
      else await blockFaculty(activeTarget.facultyUserId, trimmedReason);
      setBlockModalOpen(false);
      setBlockTarget(null);
      setBlockReason("");
      await refreshAccessControls();
      setNotice(activeTarget.isBlocked ? "Faculty academic access restored." : "Faculty academic access blocked. Chat remains available.");
    } catch (error) {
      setNotice(error?.message || "Faculty access could not be updated.");
    } finally {
      setUpdatingAccess(false);
    }
  };
  const add = (section, index) => {
    if (!subject || !selectedProfessor) return;

    if (!section.periodMatchesActive) {
      setNotice(
        `Section ${section.section} is enrolled under ${section.schoolYear} ` +
        `${terms[section.semesterCode] || section.semesterCode}, but the active academic period is ` +
        `${activePeriodLabel}. Assignment was not added.`
      );
      return;
    }

    const scheduleKey = scheduleKeyFor(section);
    const scheduleFields = schedules[scheduleKey] || { day: "", startTime: "", endTime: "" };
    const hasPartialSchedule = scheduleFields.day || scheduleFields.startTime || scheduleFields.endTime;
    if (hasPartialSchedule && (!scheduleFields.day || !scheduleFields.startTime || !scheduleFields.endTime)) {
      setNotice("Choose a day, start time, and end time to add a schedule.");
      return;
    }
    if (hasPartialSchedule && !isValidScheduleRange(scheduleFields.startTime, scheduleFields.endTime)) {
      setNotice("Start time must be before end time.");
      return;
    }
    const subjectUnits = subject.units !== null && subject.units !== undefined && String(subject.units).trim() !== ""
      ? String(subject.units)
      : null;
    const item = { id: `subject-${Date.now()}-${index}`, facultyId: professor, facultyName: nameOf(selectedProfessor), program: programName, academicSectionId: section.academicSectionId, sectionName: section.section, yearLevel: year, schoolYear: section.schoolYear, semester: terms[term], semesterCode: term, subjectCode: subject.subjectCode, subjectTitle: subject.subjectTitle, units: subjectUnits, schedule: buildFacultySchedule(scheduleFields.day, scheduleFields.startTime, scheduleFields.endTime), scheduleKey, day: "", date: "", rosterStudents: section.students || [], rosterFileName: "Created section roster", loadMode: "Manual Section Distribution", uploadedAt: new Date().toISOString() };
    if ([...saved, ...draft].some((other) => identity(other) === identity(item))) { setNotice("This subject and section already have an assignment for this term."); return; }
    const conflict = [...saved, ...draft].find((other) =>
      String(other.facultyId || other.facultyUserId) === String(item.facultyId) &&
      String(other.schoolYear || '') === String(item.schoolYear || '') &&
      String(other.semesterCode || other.semester || '').toUpperCase() === String(item.semesterCode || '').toUpperCase() &&
      facultySchedulesOverlap(other.schedule, item.schedule));
    if (conflict) {
      setNotice(`Schedule conflict: this Faculty member is already assigned to ${conflict.sectionName}, ${conflict.subjectCode}, ${formatFacultySchedule(conflict.schedule)}.`);
      return;
    }
    setDraft((current) => [...current, item]); setNotice("");
  };
  const save = async () => {
    if (!professorDraft.length || saving) return;
    setSaving(true); setNotice("");
    try {
      const pending = [...professorDraft];
      const results = await Promise.allSettled(pending.map((item) => assignFacultyLoadToBackend(item)));
      const successfulEntries = pending.flatMap((item, index) => {
        const result = results[index];
        if (result.status !== "fulfilled") return [];
        return [{ clientId: item.id, saved: {
            ...item,
            id: result.value.assignment?.id,
            facultyEmail: selectedProfessor?.email,
            academicSectionId: result.value.assignment?.academicSectionId,
            schoolYear: result.value.assignment?.schoolYear ?? item.schoolYear,
            semesterCode: result.value.assignment?.semester ?? item.semesterCode,
            semester: result.value.assignment?.semester ?? item.semester,
            schedule: result.value.assignment?.schedule ?? item.schedule,
            rosterStudents: [],
          } }];
      });
      const successful = successfulEntries.map((entry) => entry.saved);
      const successfulClientIds = new Set(successfulEntries.map((entry) => entry.clientId));
      if (successful.length > 0) {
        const next = [...saved, ...successful];
        localStorage.setItem("registrarAssignments", JSON.stringify(next));
        setSaved(next);
        setDraft((current) => current.filter((item) => !successfulClientIds.has(item.id)));
        await pushAssignmentsSharedState();
        await refreshAssignments(successful);
      }
      const failed = results.find((result) => result.status === "rejected");
      setNotice(failed ? `Some assignments were not saved: ${failed.reason?.message || "The server rejected the assignment."}` : "Assignments saved successfully.");
    } catch (error) { setNotice(error.message || "Unable to save assignments."); }
    finally { setSaving(false); }
  };
  const clearProfessorSelection = () => {
    const scheduleKeys = new Set(professorDraft.map((item) => item.scheduleKey).filter(Boolean));
    setDraft((current) => current.filter((item) => String(item.facultyId) !== professor));
    setSchedules((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !scheduleKeys.has(key))));
    setSubjectCode("");
    setNotice("");
  };

  return <div className="subject-assignment">
    <header className="sa-header"><div><div className="sa-breadcrumb">Academic Management <span>›</span> <strong>Faculty Assignments</strong></div><h2>Faculty Assignments</h2><p>Manage subject loads and academic portal access for Faculty in your department.</p></div></header>

    <div className="sa-workspace-tabs" role="tablist" aria-label="Faculty Assignments views">
      <button type="button" role="tab" aria-selected={workspaceTab === "assignments"} className={workspaceTab === "assignments" ? "active" : ""} onClick={() => setWorkspaceTab("assignments")}><Icon type="book" />Subject Assignments</button>
      <button type="button" role="tab" aria-selected={workspaceTab === "access"} className={workspaceTab === "access" ? "active" : ""} onClick={() => setWorkspaceTab("access")}><Icon type="user" />Faculty Access</button>
    </div>

    {notice && <div className="sa-info" role="status">{notice}</div>}
    {workspaceTab === "assignments" ? <div role="tabpanel" aria-label="Subject Assignments">
    <section className="sa-info sa-current-period" aria-label="Current academic period">
      <span>Academic Period</span><strong>{activePeriodLabel}</strong>
    </section>
    {mode === "manual" && <section className="sa-card sa-assigned" aria-label="Assigned Sections"><div className="sa-assigned-header"><Heading icon="cap" title="Assigned Sections" /><div className="sa-totals"><div><Icon type="book"/><span>Total Assignments<strong>{professorDraft.length}</strong></span></div><div><Icon type="cap"/><span>Total Units<strong>{pendingUnits}</strong></span></div></div></div><p className="sa-assigned-context">{selectedProfessor ? `Showing saved and pending sections for ${nameOf(selectedProfessor)}.` : "Showing all current assignments. Select a professor below to manage their load."}</p><div className="sa-table-scroll"><table><thead><tr><th>Professor</th><th>Subject Code</th><th>Subject Title</th><th>Section</th><th>School Year</th><th>Semester</th><th>Units</th><th>Schedule</th><th>Action</th></tr></thead><tbody>{displayedRows.map((item) => <tr key={`${item.assignmentState}-${item.id || identity(item)}`}><td>{item.facultyName || item.facultyEmail || "Assigned faculty"}</td><td>{item.subjectCode}</td><td>{item.subjectTitle || "Not available"}</td><td>{item.sectionName}</td><td>{item.schoolYear || "—"}</td><td>{terms[item.semesterCode] || item.semester || "—"}</td><td>{item.units === null || item.units === undefined || String(item.units).trim() === "" ? "N/A" : item.units}</td><td>{formatFacultySchedule(item.schedule, item.day)}</td><td>{item.assignmentState === "pending" ? <button type="button" className="sa-remove" aria-label={`Remove ${item.subjectCode} ${item.sectionName}`} onClick={() => setDraft((current) => current.filter((row) => row.id !== item.id))}><Icon type="trash"/></button> : <span className="sa-saved">Saved</span>}</td></tr>)}{!displayedRows.length && <tr><td colSpan="9" className="sa-empty">No assignments yet.</td></tr>}</tbody></table></div>{selectedProfessor && <footer><button type="button" className="sa-clear" disabled={saving || !professorDraft.length} onClick={clearProfessorSelection}>♧ &nbsp; Clear Selection</button><span>{professorDraft.length > 0 ? `${professorDraft.length} pending assignment${professorDraft.length > 1 ? "s" : ""}` : savedRows.length > 0 ? `${savedRows.length} saved assignment${savedRows.length > 1 ? "s" : ""}` : ""}</span><button type="button" className="sa-save" disabled={!professorDraft.length || saving} onClick={save}><Icon type="save"/>{saving ? "Saving…" : "Save Assignments"}</button></footer>}</section>}
    <div className="sa-section-title"><h3>Subject Assigning</h3><p>Select a professor, subject, section, and optional meeting schedule.</p></div>
    <section className="sa-card sa-lookup"><div><Heading title="Professor Lookup" /><div className="sa-search"><Icon type="search"/><input aria-label="Search professors" onFocus={() => setProfessorListOpen(true)} onClick={() => setProfessorListOpen(true)} placeholder="Search professor by name or faculty ID..." value={lookup} onChange={(event) => setLookup(event.target.value)}/><button aria-label="Clear professor search" onClick={() => setLookup("")}>×</button></div><div className="sa-professors">{(professorListOpen || lookup || !selectedProfessor) && (departmentFaculty.filter((person) => `${nameOf(person)} ${idOf(person)}`.toLowerCase().includes(lookup.toLowerCase())).map((person) => <button key={idOf(person)} onClick={() => selectProfessor(person)}>{nameOf(person)} <small>{idOf(person)}</small></button>))}{loading && <p>Loading professors…</p>}{!loading && !departmentFaculty.length && <p>No approved professors available.</p>}</div></div><div className="sa-professor"><span className="sa-avatar">{nameOf(selectedProfessor).split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("") || <Icon/>}</span><div><h3>{nameOf(selectedProfessor) || "Select a professor"}</h3><p>Faculty ID: &nbsp; {professor || "—"}</p><p>Department: &nbsp; {selectedProfessor?.department || selectedProfessor?.program || "—"}</p></div><div className="sa-badge"><Icon type="cap"/><div><strong>{totalUnits} units</strong><small>{rows.length} assignments</small></div></div></div></section>
    <div className="sa-tabs" role="group" aria-label="Assignment method"><button className={mode === "manual" ? "active" : ""} aria-pressed={mode === "manual"} onClick={() => { setMode("manual"); refreshAssignments().catch(() => setNotice("Current assignments could not be refreshed. Please try again.")); }}><Icon type="cap"/>Manual Assignment</button><button className={mode === "bulk" ? "active" : ""} aria-pressed={mode === "bulk"} disabled={draft.length > 0} onClick={() => setMode("bulk")}><Icon type="upload"/>Bulk Assignment</button><span>{draft.length ? "Save or clear pending assignments before switching modes." : ""}</span></div>
    {mode === "bulk" ? <div className="sa-bulk-workspace" data-testid="faculty-loading-section"><div className="sa-program"><BoundedSelect label="Academic Program" value={program} onChange={setProgram} options={availablePrograms.map((item) => ({ value: item.code, label: item.name }))} searchable /></div><FacultyLoading key={program} chairpersonDepartment={programName} assignmentMode="bulk" selectedAcademicSectionId={academicSectionFilter === "all" ? null : Number(academicSectionFilter)}/></div> : <>
    <div className="sa-columns" data-testid="assignment-workspace-columns"><section className="sa-card" data-testid="available-subjects-panel"><Heading icon="book" title="Available Subjects" /><div className="sa-filters" data-testid="available-subject-filters"><BoundedSelect label="Academic Program" value={program} onChange={(value) => { setProgram(value); setSubjectCode(""); setAcademicSectionFilter("all"); }} options={availablePrograms.map((item) => ({ value: item.code, label: item.name }))} searchable /><label>Year Level<select value={year} onChange={(event) => { setYear(event.target.value); setSubjectCode(""); setAcademicSectionFilter("all"); }}>{years.map((item) => <option key={item}>{item}</option>)}</select></label><label>Semester<select value={term} onChange={(event) => { setTerm(event.target.value); setSubjectCode(""); setAcademicSectionFilter("all"); }}>{semesterOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Section Filter<select aria-label="Section Filter" value={academicSectionFilter} onChange={(event) => setAcademicSectionFilter(event.target.value)}><option value="all">All Sections</option>{sectionFilterOptions.map((item) => <option key={item.academicSectionId} value={String(item.academicSectionId)}>{item.section}</option>)}</select></label></div><div className="sa-search"><Icon type="search"/><input aria-label="Search subjects" placeholder="Search subjects by code or title..." value={query} onChange={(event) => setQuery(event.target.value)}/></div><div className="sa-table-scroll"><table><thead><tr><th></th><th>Subject Code</th><th>Subject Title</th><th>Units</th></tr></thead><tbody>{visibleSubjects.map((item) => <tr key={item.subjectCode} className={subjectCode === item.subjectCode ? "selected" : ""}><td><input type="radio" name="subject" aria-label={`Select ${item.subjectCode}`} checked={subjectCode === item.subjectCode} onChange={() => setSubjectCode(item.subjectCode)}/></td><td><button className="sa-text-button" onClick={() => setSubjectCode(item.subjectCode)}>{item.subjectCode}</button></td><td>{item.subjectTitle}</td><td>{item.units}</td></tr>)}{!visibleSubjects.length && <tr><td colSpan="4" className="sa-empty">{loading ? "Loading subjects…" : !curriculum ? "No published curriculum for this program." : "No subjects match these filters."}</td></tr>}</tbody></table></div><p className="sa-footnote">Showing {visibleSubjects.length} of {subjects.length} subjects</p></section>
    <section className="sa-card" data-testid="available-sections-panel"><Heading title={`Available Sections${subject ? ` for ${subject.subjectCode}` : ""}`} /><div className="sa-table-scroll"><table><thead><tr><th>Section</th><th>Year Level</th><th>Day</th><th>Start Time</th><th>End Time</th><th>Action</th></tr></thead><tbody>{subject && sections.map((section, index) => { const scheduleKey = scheduleKeyFor(section); const schedule = schedules[scheduleKey] || { day: "", startTime: "", endTime: "" }; const updateSchedule = (field, value) => setSchedules((current) => ({ ...current, [scheduleKey]: { ...(current[scheduleKey] || { day: "", startTime: "", endTime: "" }), [field]: value } })); return <tr key={`${section.academicSectionId}-${section.schoolYear}`}><td className="sa-section-name">{section.section}<small>{section.schoolYear} · {section.semester}</small></td><td>{section.yearLevel}</td><td><select className="sa-schedule" aria-label={`Day for ${section.section}`} value={schedule.day} onChange={(event) => updateSchedule("day", event.target.value)}><option value="">Choose day</option>{DAY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></td><td><input className="sa-schedule" type="time" aria-label={`Start time for ${section.section}`} value={schedule.startTime} onChange={(event) => updateSchedule("startTime", event.target.value)}/></td><td><input className="sa-schedule" type="time" aria-label={`End time for ${section.section}`} value={schedule.endTime} onChange={(event) => updateSchedule("endTime", event.target.value)}/></td><td><button type="button" className="sa-assign" disabled={!selectedProfessor || saving || !section.periodMatchesActive} onClick={() => add(section, index)}>＋ Assign</button></td></tr>; })}{(!subject || !sections.length) && <tr><td colSpan="6" className="sa-empty">{!subject ? "No subject selected." : "No enrolled sections match this program, year level, and semester."}</td></tr>}</tbody></table></div><div className="sa-info sa-selected"><span>ⓘ</span><div><strong>Selected Subject: {subject ? `${subject.subjectCode} – ${subject.subjectTitle}` : "None"}</strong></div></div></section></div>
</>}</div> : <section className="sa-card" role="tabpanel" aria-label="Faculty Access" data-testid="faculty-access-management">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><Heading icon="user" title="Faculty Access Management" /><p className="sa-assigned-context">Control academic portal access for faculty in your department. Blocked faculty can still use <strong>Messaging</strong>.</p></div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{facultyAccessRows.length} Faculty</span>
      </div>
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="min-w-[15rem] flex-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Search faculty
          <span className="sa-search mt-1"><Icon type="search"/><input aria-label="Search faculty" placeholder="Search faculty..." value={facultyAccessSearch} onChange={(event) => setFacultyAccessSearch(event.target.value)}/>{facultyAccessSearch ? <button type="button" aria-label="Clear faculty search" onClick={() => setFacultyAccessSearch("")}>×</button> : null}</span>
        </label>
        <label className="min-w-[10rem] text-xs font-semibold text-slate-600 dark:text-slate-300">Status
          <select aria-label="Filter faculty access status" value={facultyAccessStatus} onChange={(event) => setFacultyAccessStatus(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-normal dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"><option value="all">All Status</option><option value="active">Active</option><option value="blocked">Blocked</option></select>
        </label>
      </div>
      {facultyAccessRows.length === 0 ? <div className="flex flex-col items-center px-4 py-12 text-center"><span className="sa-icon h-12 w-12"><Icon type="user"/></span><h3 className="mt-4 font-bold text-[#003366] dark:text-sky-300">No faculty accounts are available for this department.</h3><p className="mt-1 max-w-lg text-sm text-slate-500 dark:text-slate-400">Faculty assigned to {chairpersonDepartment || programName || "this department"} will appear here once their accounts are active.</p><button type="button" onClick={refreshAccessControls} className="mt-5 rounded-lg bg-[#003366] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#00264d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Refresh Faculty List</button></div> : filteredFacultyAccessRows.length === 0 ? <p className="sa-empty py-12 text-center">No matching faculty found.</p> : <div className="sa-table-scroll">
        <table className="sa-access-table">
          <thead><tr><th>Faculty</th><th>Department</th><th>Access Status</th><th>Action</th></tr></thead>
          <tbody>{filteredFacultyAccessRows.map((row) => <tr key={String(row.facultyUserId || row.email)}>
            <td><span className="block font-semibold text-slate-900 dark:text-slate-100">{row.fullName}</span><span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{row.facultyId || "—"} | {row.email || "—"}</span></td>
            <td>{row.department || "—"}</td>
            <td><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${row.isBlocked ? "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"}`}><span aria-hidden="true">●</span>{row.isBlocked ? "Blocked" : "Active"}</span>{row.isBlocked && row.reason ? <span className="mt-1.5 block max-w-xs text-xs text-slate-500 dark:text-slate-400">Reason: {row.reason}</span> : null}</td>
            <td><button type="button" disabled={updatingAccess} onClick={() => openBlockFacultyModal(row)} className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-[#003366] hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:border-sky-800 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-sky-950/40">Manage</button></td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>}
    <Modal isOpen={blockModalOpen} onClose={() => { if (!updatingAccess) { setBlockModalOpen(false); setBlockTarget(null); setBlockError(""); } }} title="Manage Faculty Access" closeOnBackdrop={!updatingAccess} closeOnEscape={!updatingAccess} panelClassName="max-w-xl">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start gap-3"><span className="sa-avatar h-11 w-11"><Icon type="user"/></span><div className="min-w-0"><h4 className="font-bold text-[#003366] dark:text-sky-300">{blockTarget?.fullName || "Faculty member"}</h4><dl className="mt-2 grid gap-1 text-xs text-slate-600 dark:text-slate-300"><div><dt className="inline font-semibold">Faculty ID: </dt><dd className="inline">{blockTarget?.facultyId || "—"}</dd></div><div><dt className="inline font-semibold">Email: </dt><dd className="inline break-all">{blockTarget?.email || "—"}</dd></div><div><dt className="inline font-semibold">Department/Program: </dt><dd className="inline">{blockTarget?.department || chairpersonDepartment || "—"}</dd></div></dl></div></div>
      </div>
      <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Current Access: <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${blockTarget?.isBlocked ? "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"}`}><span aria-hidden="true">●</span>{blockTarget?.isBlocked ? "Blocked" : "Active"}</span></div>
      {!blockTarget?.isBlocked ? <><div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">Blocking academic access will disable academic functions such as grade encoding and faculty sections, but <strong>Messaging remains available.</strong></div><label className="mt-4 block text-sm font-semibold text-slate-700 dark:text-slate-200">Reason for restriction *
        <textarea aria-label="Reason for restriction" value={blockReason} onChange={(event) => { setBlockReason(event.target.value); if (blockError) setBlockError(""); }} rows={4} className="mt-2 w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-600/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white" placeholder="Enter the reason for restricting this faculty's academic access..." />
      </label></> : <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">Unblocking restores this faculty member's academic portal functions. Messaging access is already available.</p>}
      {blockError && <p role="alert" className="mt-2 text-xs font-semibold text-red-600">{blockError}</p>}
      <div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => { setBlockModalOpen(false); setBlockTarget(null); setBlockError(""); }} disabled={updatingAccess} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-600">Cancel</button><button type="button" onClick={updateFacultyAccess} disabled={(!blockTarget?.isBlocked && !blockReason.trim()) || updatingAccess} className={`rounded-lg px-4 py-2 text-sm font-bold text-white disabled:bg-slate-400 ${blockTarget?.isBlocked ? "bg-emerald-700 hover:bg-emerald-800" : "bg-red-700 hover:bg-red-800"}`}>{updatingAccess ? "Updating…" : blockTarget?.isBlocked ? "Unblock Faculty" : "Block Faculty"}</button></div>
    </Modal>
  </div>;
}
