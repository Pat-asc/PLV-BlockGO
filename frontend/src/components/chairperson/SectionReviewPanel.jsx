import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeGradeStatus, getReviewStatusLabel } from "../../utils/chairpersonHelpers";
import { getGradeEquivalent } from "../../utils/gradingHelpers";
import Modal from "../../services/Modal";
import StatusBadge from "../shared/StatusBadge";
import GradeVersionHistory from "../shared/GradeVersionHistory";
import BackButton from "../shared/BackButton";

const getEncodingTermLabel = (term = "") =>
  String(term || "").toLowerCase() === "finals" ? "Finals" : "Midterm";

const studentNameCollator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

const compareStudentReviewRows = (left, right) => {
  for (const field of ["id", "lastName", "firstName", "middleName", "name"]) {
    const comparison = studentNameCollator.compare(String(left[field] || "").trim(), String(right[field] || "").trim());
    if (comparison !== 0) return comparison;
  }
  return 0;
};

const compareGradeReviewRows = (left, right) => {
  const leftGrade = Number(left.currentGrade);
  const rightGrade = Number(right.currentGrade);
  const leftHasGrade = Number.isFinite(leftGrade) && leftGrade > 0;
  const rightHasGrade = Number.isFinite(rightGrade) && rightGrade > 0;
  if (leftHasGrade && rightHasGrade && leftGrade !== rightGrade) return rightGrade - leftGrade;
  if (leftHasGrade !== rightHasGrade) return leftHasGrade ? -1 : 1;
  return compareStudentReviewRows(left, right);
};

const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== "" && String(value) !== "-";

const gradeValuesMatch = (left, right) => {
  if (!hasValue(left) || !hasValue(right)) return true;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber === rightNumber;
  return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
};

const formatSubmittedTimestamp = (value) => {
  if (!value) return "Recorded on submission";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
};

const metadataItems = (section, activeTerm) => [
  ["Faculty", section.facultyName || "Unknown Faculty"],
  ["Section", section.sectionName || "Unknown Section"],
  ["Subject", [section.subjectCode, section.subjectTitle].filter(Boolean).join(" — ") || "Unknown Subject"],
  ["School Year", section.schoolYear || "Not available"],
  ["Semester", section.semester || "Not available"],
  ["Term", getEncodingTermLabel(section.term || activeTerm)],
];

function SectionReviewPanel({
  selectedSection,
  activeTerm,
  sourceView,
  onSendBack,
  onApprove,
  onSendToRegistrar,
  onViewIpfs,
  onRetryArchive,
  onClose,
  onBack,
  observerOnly = false,
}) {
  const [draftNotes, setDraftNotes] = useState({});
  const [monitoringView, setMonitoringView] = useState("submission");
  const [approveConfirmationOpen, setApproveConfirmationOpen] = useState(false);
  const [returnConfirmationOpen, setReturnConfirmationOpen] = useState(false);
  const [handoffConfirmationOpen, setHandoffConfirmationOpen] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isReturning, setIsReturning] = useState(false);
  const [isSendingToRegistrar, setIsSendingToRegistrar] = useState(false);
  const [isRetryingArchive, setIsRetryingArchive] = useState(false);
  const [actionError, setActionError] = useState("");
  const approveInFlightRef = useRef(false);
  const returnInFlightRef = useRef(false);
  const handoffInFlightRef = useRef(false);
  const note = selectedSection
    ? draftNotes[selectedSection.reviewKey] ?? selectedSection.reviewNote ?? ""
    : "";
  const busy = isApproving || isReturning || isSendingToRegistrar || isRetryingArchive;

  useEffect(() => {
    setMonitoringView("submission");
    setApproveConfirmationOpen(false);
    setReturnConfirmationOpen(false);
    setHandoffConfirmationOpen(false);
    setActionError("");
    approveInFlightRef.current = false;
    returnInFlightRef.current = false;
    handoffInFlightRef.current = false;
    setIsApproving(false);
    setIsReturning(false);
    setIsSendingToRegistrar(false);
    setIsRetryingArchive(false);
  }, [selectedSection?.reviewKey]);

  const rows = useMemo(() => {
    if (!selectedSection) return [];
    const isFinalsTerm = String(activeTerm).toLowerCase() === "finals";
    return selectedSection.students.map((student) => {
      const studentId = student.studentNo || student.studentId || student.id;
      const record = selectedSection.grades[student.studentNo] ||
        selectedSection.grades[student.studentId] || selectedSection.grades[student.id] || {};
      const referenceRecord = selectedSection.referenceGrades?.[studentId] ||
        selectedSection.referenceGrades?.[student.studentId] || {};
      const currentGrade = isFinalsTerm ? (record.finals || "-") : (record.midterm || "-");
      const referenceGrade = referenceRecord.grade || referenceRecord.midterm ||
        (isFinalsTerm ? record.midterm : "-");
      const beforeGrade = isFinalsTerm
        ? (record.beforeFinals || record.beforeGrade || referenceGrade || currentGrade || "-")
        : (record.beforeMidterm || record.beforeGrade || referenceGrade || currentGrade || "-");
      const submittedGrade = isFinalsTerm
        ? (record.submittedFinals || record.submittedGrade || currentGrade || "-")
        : (record.submittedMidterm || record.submittedGrade || currentGrade || "-");
      const submissionVersion = Number(record.submissionVersion || selectedSection.submissionVersion || 1);
      const submittedAt = record.submittedAt || selectedSection.submittedAt || selectedSection.finalizedAt || "";
      const workflowStatus = record.workflowStatus || getReviewStatusLabel(selectedSection.reviewStatus || "pending");
      const numericMidterm = Number(record.midterm);
      const numericFinals = Number(record.finals);
      const finalAverage = Number.isFinite(numericMidterm) && Number.isFinite(numericFinals) && numericMidterm > 0 && numericFinals > 0
        ? ((numericMidterm + numericFinals) / 2).toFixed(2) : "-";
      const gradeEquivalent = finalAverage !== "-" ? getGradeEquivalent(Number(finalAverage)) : finalAverage;
      const standing = record.standing || "active";
      const normalizedStanding = String(standing).toLowerCase();
      const equivalentNumber = Number(gradeEquivalent);
      const isDeansListCandidate = isFinalsTerm &&
        Number.isFinite(equivalentNumber) && equivalentNumber > 0 && equivalentNumber <= 1.75 &&
        !["dropped", "unofficially_dropped", "withdrawn", "incomplete"].includes(normalizedStanding);
      const integrityStatus = String(record.integrityStatus || "").toLowerCase();
      const mismatch = hasValue(referenceGrade) &&
        (integrityStatus === "mismatch" || !gradeValuesMatch(currentGrade, referenceGrade));
      const beforeAfterChanged = hasValue(beforeGrade) && hasValue(submittedGrade) && !gradeValuesMatch(beforeGrade, submittedGrade);

      return {
        id: studentId,
        recordId: record.recordId || record.id || "",
        name: student.fullName || `${student.lastName || ""}, ${student.firstName || ""}`.replace(/^,\s*/, "") || student.studentId || "-",
        lastName: student.lastName || "",
        firstName: student.firstName || "",
        middleName: student.middleName || "",
        currentGrade,
        referenceGrade,
        beforeGrade,
        submittedGrade,
        beforeAfterChanged,
        submissionVersion,
        submittedAt,
        workflowStatus,
        standing,
        isDeansListCandidate,
        flagged: !!record.flagged,
        mismatch,
        status: computeGradeStatus(record, activeTerm),
      };
    }).sort(compareGradeReviewRows);
  }, [selectedSection, activeTerm]);

  const differenceCount = rows.filter((row) => row.mismatch).length;
  const outcomeSummary = useMemo(() => rows.reduce((summary, row) => {
    const status = String(row.status || "").toLowerCase();
    const standing = String(row.standing || "").toLowerCase();
    if (status === "passed") summary.passed += 1;
    if (status === "failed") summary.failed += 1;
    if (standing === "dropped") summary.d += 1;
    if (standing === "unofficially_dropped") summary.ud += 1;
    if (standing === "withdrawn") summary.w += 1;
    if (standing === "incomplete") summary.inc += 1;
    if (row.flagged) summary.flagged += 1;
    return summary;
  }, { passed: 0, failed: 0, d: 0, ud: 0, w: 0, inc: 0, flagged: 0 }), [rows]);
  const reviewStatus = selectedSection?.reviewStatus || "pending";
  const alreadySent = Boolean(selectedSection?.sentToRegistrar);
  const canReturn = !observerOnly && (reviewStatus === "submitted" || reviewStatus === "approved") && !alreadySent;
  const canApprove = !observerOnly && reviewStatus === "submitted";
  const showHandoff = !observerOnly && reviewStatus === "approved";
  const finalized = reviewStatus === "forwarded";
  const sectionSubmissionVersion = Number(selectedSection?.submissionVersion || rows[0]?.submissionVersion || 1);
  const sectionSubmittedAt = selectedSection?.submittedAt || rows[0]?.submittedAt || selectedSection?.finalizedAt || "";
  const sectionStatusLabel = alreadySent ? "Sent to Registrar" : getReviewStatusLabel(reviewStatus);

  const confirmApprove = async () => {
    if (approveInFlightRef.current) return;
    approveInFlightRef.current = true;
    setIsApproving(true);
    setActionError("");
    try {
      await onApprove(note);
      setApproveConfirmationOpen(false);
    } catch (error) {
      setActionError(error?.message || "Approval could not be completed. Please refresh and try again.");
    } finally {
      approveInFlightRef.current = false;
      setIsApproving(false);
    }
  };

  const confirmReturn = async () => {
    if (returnInFlightRef.current) return;
    returnInFlightRef.current = true;
    setIsReturning(true);
    setActionError("");
    try {
      await onSendBack(note.trim());
      setReturnConfirmationOpen(false);
    } catch (error) {
      setActionError(error?.message || "The section could not be returned. Please refresh and try again.");
    } finally {
      returnInFlightRef.current = false;
      setIsReturning(false);
    }
  };

  const confirmHandoff = async () => {
    if (handoffInFlightRef.current) return;
    handoffInFlightRef.current = true;
    setIsSendingToRegistrar(true);
    setActionError("");
    try {
      await onSendToRegistrar();
      setHandoffConfirmationOpen(false);
    } catch (error) {
      setActionError(error?.message || "The grades could not be sent to the Registrar. Please refresh and try again.");
    } finally {
      handoffInFlightRef.current = false;
      setIsSendingToRegistrar(false);
    }
  };

  const requestClose = useCallback(() => {
    if (!busy) (onClose || onBack)?.();
  }, [busy, onBack, onClose]);

  const requestBack = useCallback(() => {
    if (!busy) (onBack || onClose)?.();
  }, [busy, onBack, onClose]);

  return (
    <>
      <Modal
        isOpen={Boolean(selectedSection)}
        onClose={requestClose}
        title="Review Encoded Grades"
        closeOnBackdrop={!busy}
        closeOnEscape={!busy}
        panelClassName="flex max-h-[92vh] max-w-6xl flex-col overflow-hidden p-4 sm:p-6"
        bodyClassName="flex min-h-0 flex-1 flex-col"
      >
        {selectedSection ? (
          <div className="flex min-h-0 flex-1 flex-col" data-testid="section-review-modal-content" data-source-view={sourceView || ""}>
            <div className="shrink-0 space-y-3">
              <div className="flex items-center border-b border-slate-200 pb-3 dark:border-slate-700">
                <BackButton
                  onClick={requestBack}
                  label="Back to Sections"
                  disabled={busy}
                  className="-ml-2 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-sky-300"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
                {metadataItems(selectedSection, activeTerm).map(([label, value]) => (
                  <div key={label} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100" title={value}>{value}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2" aria-label="Review summary">
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{rows.length} Students</span>
                <span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${differenceCount ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'}`}>
                  {differenceCount} {differenceCount === 1 ? 'Difference' : 'Differences'} Detected
                </span>
                <StatusBadge status={alreadySent ? "forwarded" : reviewStatus} label={sectionStatusLabel} />
                {[["Passed", outcomeSummary.passed], ["Failed", outcomeSummary.failed], ["D", outcomeSummary.d], ["UD", outcomeSummary.ud], ["W", outcomeSummary.w], ["INC", outcomeSummary.inc], ["Flagged", outcomeSummary.flagged]].map(([label, count]) => (
                  <span key={label} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"><span>{label}</span> <strong>{count}</strong></span>
                ))}
              </div>
              {observerOnly && !finalized ? <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">Department visibility only. The Registrar owns return and finalization decisions for this submission.</p> : null}
              {observerOnly ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/70" data-testid="chairperson-monitoring-actions">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                    <span className="rounded bg-white px-2.5 py-1 font-semibold shadow-sm dark:bg-slate-900">Submission Version: v{sectionSubmissionVersion}</span>
                    <span className="rounded bg-white px-2.5 py-1 font-semibold shadow-sm dark:bg-slate-900">Submitted At: {formatSubmittedTimestamp(sectionSubmittedAt)}</span>
                    <span className="rounded bg-white px-2.5 py-1 font-semibold shadow-sm dark:bg-slate-900">Current Status: {sectionStatusLabel}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setMonitoringView("submission")}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                        monitoringView === "submission"
                          ? "bg-[#003366] text-white"
                          : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                      }`}
                    >
                      View Submission
                    </button>
                    <button
                      type="button"
                      onClick={() => setMonitoringView("beforeAfter")}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                        monitoringView === "beforeAfter"
                          ? "bg-[#003366] text-white"
                          : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                      }`}
                    >
                      View Before/After
                    </button>
                    <button
                      type="button"
                      onClick={() => setMonitoringView("history")}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                        monitoringView === "history"
                          ? "bg-[#003366] text-white"
                          : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                      }`}
                    >
                      View History
                    </button>
                  </div>
                </div>
              ) : null}
              {String(activeTerm).toLowerCase() === "finals" ? <p className="text-xs text-amber-800 dark:text-amber-300">Highlighted names are in the Dean&apos;s List grade range. Official eligibility still depends on all semester subjects.</p> : null}
            </div>

            <div className="mt-3 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-1" data-testid="review-scroll-region">
              <div className="mb-3 flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-sky-900 dark:bg-sky-950/40 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-blue-900 dark:text-sky-200">Attached Grading Sheet</p>
                  <p className="text-xs text-blue-700 dark:text-sky-300">{selectedSection.ipfsCid ? "Encrypted IPFS archive is available." : "No IPFS attachment is currently available."}</p>
                </div>
                <button type="button" onClick={async () => {
                  if (selectedSection.ipfsCid) return onViewIpfs?.(selectedSection.ipfsCid);
                  if (!onRetryArchive || isRetryingArchive) return;
                  setIsRetryingArchive(true);
                  try { await onRetryArchive(); } finally { setIsRetryingArchive(false); }
                }} disabled={!selectedSection.ipfsCid && (!onRetryArchive || isRetryingArchive)} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-400">
                  {selectedSection.ipfsCid ? "Decrypt & View" : onRetryArchive ? (isRetryingArchive ? "Retrying..." : "Retry Archive") : "Not Available"}
                </button>
              </div>

              {observerOnly && monitoringView === "beforeAfter" ? (
                <div className="box-border min-w-0 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700" data-testid="chairperson-before-after-panel">
                  <div className="w-full min-w-0 overflow-x-auto overflow-y-hidden" data-testid="chairperson-before-after-scroll">
                    <div className="box-border w-full min-w-[960px]" data-testid="chairperson-before-after-canvas">
                      <div className="box-border w-full bg-[#003366] px-4 py-3 text-white dark:bg-sky-900" data-testid="chairperson-before-after-header">
                        <h4 className="font-bold">Before vs. After Submission Snapshot (Read-Only Audit)</h4>
                        <p className="text-xs text-blue-100">Compares the pre-submission grade snapshot (Before Value) against the immutable Faculty-submitted snapshot (Submitted Value).</p>
                      </div>
                      <table className="box-border w-full table-fixed border-collapse text-sm" data-testid="chairperson-before-after-table">
                    <thead className="bg-slate-100 text-left text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      <tr>
                        <th className="box-border w-[12%] px-3 py-2">Faculty</th>
                        <th className="box-border w-[10%] px-3 py-2">Subject</th>
                        <th className="box-border w-[9%] px-3 py-2">Section</th>
                        <th className="box-border w-[17%] px-3 py-2">Student</th>
                        <th className="box-border w-[9%] px-3 py-2">Before Value</th>
                        <th className="box-border w-[10%] px-3 py-2">Submitted Value</th>
                        <th className="box-border w-[9%] px-3 py-2">Submission Version</th>
                        <th className="box-border w-[14%] px-3 py-2">Submitted Timestamp</th>
                        <th className="box-border w-[10%] px-3 py-2">Current Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={`before-after-${row.id}`}
                          data-before-after-changed={row.beforeAfterChanged ? "true" : "false"}
                          className={`border-t border-slate-200 dark:border-slate-700 ${
                            row.beforeAfterChanged ? "bg-amber-50 dark:bg-amber-950/30" : ""
                          }`}
                        >
                          <td className="break-words px-3 py-2 text-xs">{selectedSection.facultyName || "Unknown Faculty"}</td>
                          <td className="break-words px-3 py-2 text-xs">{selectedSection.subjectCode || "Unknown Subject"}</td>
                          <td className="break-words px-3 py-2 text-xs">{selectedSection.sectionName || "Unknown Section"}</td>
                          <td className="break-words px-3 py-2 font-medium">
                            <span className="block font-mono text-xs text-slate-500">{row.id}</span>
                            <span>{row.name}</span>
                          </td>
                          <td className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">{row.beforeGrade}</td>
                          <td className={`px-3 py-2 font-bold ${row.beforeAfterChanged ? "text-amber-800 dark:text-amber-300" : "text-[#003366] dark:text-sky-300"}`}>
                            {row.submittedGrade}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">v{row.submissionVersion}</td>
                          <td className="px-3 py-2 text-xs">{formatSubmittedTimestamp(row.submittedAt)}</td>
                          <td className="px-3 py-2 text-xs font-semibold">{row.workflowStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : observerOnly && monitoringView === "history" ? (
                <div className="box-border min-w-0 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700" data-testid="chairperson-history-panel">
                  <div className="w-full min-w-0 overflow-x-auto overflow-y-hidden" data-testid="chairperson-history-scroll">
                    <div className="box-border w-full min-w-[880px]" data-testid="chairperson-history-canvas">
                      <div className="box-border w-full bg-slate-700 px-4 py-3 text-white dark:bg-slate-800" data-testid="chairperson-history-header">
                        <h4 className="font-bold">Submission & Ledger Version History</h4>
                        <p className="text-xs text-slate-200">Read-only audit history of Faculty submissions and finalized ledger versions.</p>
                      </div>
                      <table className="box-border w-full table-fixed border-collapse text-sm" data-testid="chairperson-history-table">
                    <thead className="bg-slate-100 text-left text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      <tr>
                        <th className="box-border w-[13%] px-3 py-2">Student ID</th>
                        <th className="box-border w-[20%] px-3 py-2">Student</th>
                        <th className="box-border w-[11%] px-3 py-2">Before Value</th>
                        <th className="box-border w-[12%] px-3 py-2">Submitted Value</th>
                        <th className="box-border w-[11%] px-3 py-2">Submission Version</th>
                        <th className="box-border w-[18%] px-3 py-2">Submitted Timestamp</th>
                        <th className="box-border w-[15%] px-3 py-2">Ledger History</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={`history-${row.id}`} className="border-t border-slate-200 dark:border-slate-700">
                          <td className="break-words px-3 py-2 font-mono text-xs">{row.id}</td>
                          <td className="break-words px-3 py-2 font-medium">{row.name}</td>
                          <td className="px-3 py-2 font-semibold">{row.beforeGrade}</td>
                          <td className="px-3 py-2 font-bold text-[#003366] dark:text-sky-300">{row.submittedGrade}</td>
                          <td className="px-3 py-2 font-mono text-xs">v{row.submissionVersion}</td>
                          <td className="px-3 py-2 text-xs">{formatSubmittedTimestamp(row.submittedAt)}</td>
                          <td className="px-3 py-2">
                            {finalized && row.recordId ? (
                              <GradeVersionHistory recordId={row.recordId} allowCorrection />
                            ) : (
                              <span className="text-xs text-slate-400">PostgreSQL snapshot (v{row.submissionVersion})</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid min-w-0 gap-4 lg:grid-cols-2" data-testid="grade-comparison-grid">
                  <div className="box-border min-w-0 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="w-full min-w-0 overflow-x-auto overflow-y-hidden" data-testid="chairperson-submission-scroll">
                      <div className="box-border w-full min-w-[640px]" data-testid="chairperson-submission-canvas">
                        <h4 className="box-border w-full bg-[#003366] px-4 py-3 font-bold text-white dark:bg-sky-900">Current / Submitted</h4>
                        <table className="box-border w-full table-fixed border-collapse text-sm">
                      <thead className="bg-slate-100 text-left text-slate-700 dark:bg-slate-800 dark:text-slate-200"><tr><th className="box-border w-[16%] px-3 py-2">Student ID</th><th className="box-border w-[30%] px-3 py-2">Student</th><th className="box-border w-[14%] px-3 py-2">{getEncodingTermLabel(activeTerm)}</th><th className="box-border w-[18%] px-3 py-2">Status</th><th className="box-border w-[22%] px-3 py-2">Ledger History</th></tr></thead>
                      <tbody>{rows.map((row) => <tr key={`current-${row.id}`} data-mismatch={row.mismatch ? "true" : "false"} className={`border-t border-slate-200 dark:border-slate-700 ${row.mismatch ? 'bg-red-50 dark:bg-red-950/30' : row.flagged ? 'bg-amber-50 dark:bg-amber-950/20' : ''}`}><td className="break-words px-3 py-2 font-mono text-xs">{row.id}</td><td className="break-words px-3 py-2 font-medium"><span data-deans-list-candidate={row.isDeansListCandidate ? "true" : "false"} className={row.isDeansListCandidate ? "rounded bg-amber-200 px-1.5 py-0.5 font-bold text-amber-950 ring-1 ring-amber-400" : ""}>{row.name}</span></td><td className={`px-3 py-2 font-bold ${row.mismatch ? 'text-red-700 dark:text-red-300' : ''}`}>{row.currentGrade}</td><td className="break-words px-3 py-2 capitalize">{String(row.status).replaceAll('_', ' ')}</td><td className="px-3 py-2">{finalized && row.recordId ? <GradeVersionHistory recordId={row.recordId} allowCorrection /> : <span className="text-xs text-slate-400">Not yet finalized</span>}</td></tr>)}</tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                  <div className="box-border min-w-0 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="w-full min-w-0 overflow-x-auto overflow-y-hidden" data-testid="chairperson-reference-scroll">
                      <div className="box-border w-full min-w-[520px]" data-testid="chairperson-reference-canvas">
                        <h4 className="box-border w-full bg-slate-700 px-4 py-3 font-bold text-white dark:bg-slate-800">Comparison / Reference</h4>
                        <table className="box-border w-full table-fixed border-collapse text-sm">
                      <thead className="bg-slate-100 text-left text-slate-700 dark:bg-slate-800 dark:text-slate-200"><tr><th className="box-border w-[18%] px-3 py-2">Student ID</th><th className="box-border w-[36%] px-3 py-2">Student</th><th className="box-border w-[18%] px-3 py-2">Reference</th><th className="box-border w-[28%] px-3 py-2">Standing</th></tr></thead>
                      <tbody>{rows.map((row) => <tr key={`reference-${row.id}`} data-mismatch={row.mismatch ? "true" : "false"} className={`border-t border-slate-200 dark:border-slate-700 ${row.mismatch ? 'bg-red-50 dark:bg-red-950/30' : ''}`}><td className="break-words px-3 py-2 font-mono text-xs">{row.id}</td><td className="break-words px-3 py-2 font-medium"><span data-deans-list-candidate={row.isDeansListCandidate ? "true" : "false"} className={row.isDeansListCandidate ? "rounded bg-amber-200 px-1.5 py-0.5 font-bold text-amber-950 ring-1 ring-amber-400" : ""}>{row.name}</span></td><td className={`px-3 py-2 font-bold ${row.mismatch ? 'text-red-700 dark:text-red-300' : ''}`}>{row.referenceGrade}</td><td className="break-words px-3 py-2 capitalize">{String(row.standing).replaceAll('_', ' ')}</td></tr>)}</tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {reviewStatus === "returned" && selectedSection.reviewNote ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"><span className="font-bold">Return remarks:</span> {selectedSection.reviewNote}</div> : null}
            </div>

            <footer className="mt-3 shrink-0 border-t border-slate-200 pt-3 dark:border-slate-700" data-testid="review-modal-footer">
              {canReturn ? <label className="mb-3 block text-sm font-semibold text-slate-700 dark:text-slate-200">Correction remarks
                <textarea value={note} onChange={(event) => setDraftNotes((previous) => ({ ...previous, [selectedSection.reviewKey]: event.target.value }))} rows={2} placeholder="Required when returning grades to Faculty" className="mt-1 w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#003366] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              </label> : null}
              {actionError ? <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{actionError}</p> : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                <div className="flex flex-col gap-2 sm:flex-row">
                  {canReturn ? <button type="button" onClick={() => { setActionError(""); setReturnConfirmationOpen(true); }} disabled={note.trim().length < 3 || busy} className="min-h-10 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-slate-400">Return for Correction</button> : null}
                  {canApprove ? <button type="button" onClick={() => { setActionError(""); setApproveConfirmationOpen(true); }} disabled={busy} className="min-h-10 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400">Approve Section</button> : null}
                  {showHandoff ? <button type="button" onClick={() => { setActionError(""); setHandoffConfirmationOpen(true); }} disabled={!onSendToRegistrar || !selectedSection.canSendToRegistrar || alreadySent || busy} className="min-h-10 rounded-lg bg-[#003366] px-4 py-2 text-sm font-semibold text-white hover:bg-[#00264d] disabled:cursor-not-allowed disabled:bg-slate-400">Send to Registrar</button> : null}
                </div>
              </div>
            </footer>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={returnConfirmationOpen} onClose={() => { if (!isReturning) setReturnConfirmationOpen(false); }} title="Return Grades to Faculty" description={`Return this section for correction with the following remarks?\n\n${note.trim()}`} closeOnBackdrop={!isReturning} closeOnEscape={!isReturning}>
        <div className="flex justify-end gap-3"><button type="button" onClick={() => setReturnConfirmationOpen(false)} disabled={isReturning} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-600">Cancel</button><button type="button" onClick={confirmReturn} disabled={isReturning} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{isReturning ? "Returning..." : "Confirm Return"}</button></div>
      </Modal>
      <Modal isOpen={approveConfirmationOpen} onClose={() => { if (!isApproving) setApproveConfirmationOpen(false); }} title="Approve Grades" description="Approve this submitted section? It will move to Approved Grades and become eligible for Registrar handoff." closeOnBackdrop={!isApproving} closeOnEscape={!isApproving}>
        <div className="flex justify-end gap-3"><button type="button" onClick={() => setApproveConfirmationOpen(false)} disabled={isApproving} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-600">Cancel</button><button type="button" onClick={confirmApprove} disabled={isApproving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{isApproving ? "Approving..." : "Approve Grades"}</button></div>
      </Modal>
      <Modal isOpen={handoffConfirmationOpen} onClose={() => { if (!isSendingToRegistrar) setHandoffConfirmationOpen(false); }} title="Send to Registrar" description="Send this approved section to the Registrar finalization queue? This does not finalize the ledger record." closeOnBackdrop={!isSendingToRegistrar} closeOnEscape={!isSendingToRegistrar}>
        <div className="flex justify-end gap-3"><button type="button" onClick={() => setHandoffConfirmationOpen(false)} disabled={isSendingToRegistrar} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-600">Cancel</button><button type="button" onClick={confirmHandoff} disabled={isSendingToRegistrar} className="rounded-lg bg-[#003366] px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{isSendingToRegistrar ? "Sending..." : "Send to Registrar"}</button></div>
      </Modal>
    </>
  );
}

export default SectionReviewPanel;
