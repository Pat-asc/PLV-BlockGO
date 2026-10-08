import React, { useEffect, useMemo, useRef, useState } from "react";
import { computeGradeStatus, getReviewStatusClasses, getReviewStatusLabel } from "../../utils/chairpersonHelpers";
import { getGradeEquivalent } from "../../utils/gradingHelpers";
import Modal from "../../services/Modal";
import BackButton from "../shared/BackButton";
import StatusBadge from "../shared/StatusBadge";
import GradeVersionHistory from "../shared/GradeVersionHistory";

const formatLogDate = (value) => {
  if (!value) return "--";

  return new Date(value).toLocaleString();
};

const getEncodingTermLabel = (term = "") =>
  String(term || "").toLowerCase() === "finals" ? "Finals" : "Midterm";

const studentNameCollator = new Intl.Collator("en", {
  sensitivity: "base",
  numeric: true,
});

const compareStudentReviewRows = (left, right) => {
  for (const field of ["id", "lastName", "firstName", "middleName", "name"]) {
    const comparison = studentNameCollator.compare(
      String(left[field] || "").trim(),
      String(right[field] || "").trim()
    );
    if (comparison !== 0) return comparison;
  }
  return 0;
};

const compareGradeReviewRows = (left, right, activeTerm) => {
  const gradeField = String(activeTerm).toLowerCase() === "finals" ? "finals" : "midterm";
  const leftGrade = Number(left[gradeField]);
  const rightGrade = Number(right[gradeField]);
  const leftHasGrade = Number.isFinite(leftGrade) && leftGrade > 0;
  const rightHasGrade = Number.isFinite(rightGrade) && rightGrade > 0;

  if (leftHasGrade && rightHasGrade && leftGrade !== rightGrade) {
    return rightGrade - leftGrade;
  }
  if (leftHasGrade !== rightHasGrade) return leftHasGrade ? -1 : 1;
  return compareStudentReviewRows(left, right);
};

function SectionReviewPanel({
  selectedSection,
  activeTerm,
  onSendBack,
  onApprove,
  onSendToRegistrar,
  onViewIpfs,
  onBack,
}) {
  const [draftNotes, setDraftNotes] = useState({});
  const [approveConfirmationOpen, setApproveConfirmationOpen] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [approveError, setApproveError] = useState("");
  const [handoffConfirmationOpen, setHandoffConfirmationOpen] = useState(false);
  const [isSendingToRegistrar, setIsSendingToRegistrar] = useState(false);
  const [handoffError, setHandoffError] = useState("");
  const approveInFlightRef = useRef(false);
  const handoffInFlightRef = useRef(false);
  const note = selectedSection
    ? draftNotes[selectedSection.reviewKey] ?? selectedSection.reviewNote ?? ""
    : "";

  useEffect(() => {
    setApproveConfirmationOpen(false);
    setApproveError("");
    approveInFlightRef.current = false;
    setIsApproving(false);
    setHandoffConfirmationOpen(false);
    setHandoffError("");
    handoffInFlightRef.current = false;
    setIsSendingToRegistrar(false);
  }, [selectedSection?.reviewKey]);

  const confirmApprove = async () => {
    if (approveInFlightRef.current) return;
    approveInFlightRef.current = true;
    setIsApproving(true);
    setApproveError("");
    try {
      await onApprove(note);
      setApproveConfirmationOpen(false);
    } catch (error) {
      setApproveError(error?.message || "Approval could not be completed. Please refresh and try again.");
    } finally {
      approveInFlightRef.current = false;
      setIsApproving(false);
    }
  };

  const confirmHandoff = async () => {
    if (handoffInFlightRef.current) return;
    handoffInFlightRef.current = true;
    setIsSendingToRegistrar(true);
    setHandoffError("");
    try {
      await onSendToRegistrar();
      setHandoffConfirmationOpen(false);
    } catch (error) {
      setHandoffError(error?.message || "The grades could not be sent to the Registrar. Please refresh and try again.");
    } finally {
      handoffInFlightRef.current = false;
      setIsSendingToRegistrar(false);
    }
  };

  const rows = useMemo(() => {
    if (!selectedSection) return [];

    return selectedSection.students.map((student) => {
      const studentId = student.studentNo || student.studentId || student.id;
      const record =
        selectedSection.grades[student.studentNo] ||
        selectedSection.grades[student.studentId] ||
        selectedSection.grades[student.id] ||
        {};
      const referenceRecord = selectedSection.referenceGrades?.[studentId] ||
        selectedSection.referenceGrades?.[student.studentId] || {};

      const numericMidterm = Number(record.midterm);
      const numericFinals = Number(record.finals);
      const finalAverage =
        Number.isFinite(numericMidterm) &&
        Number.isFinite(numericFinals) &&
        numericMidterm > 0 &&
        numericFinals > 0
          ? ((numericMidterm + numericFinals) / 2).toFixed(2)
          : "-";

      const gradeEquivalent =
        finalAverage !== "-" && !Number.isNaN(Number(finalAverage))
          ? getGradeEquivalent(Number(finalAverage))
          : finalAverage;
      const standing = record.standing || "active";
      const normalizedStanding = String(standing).toLowerCase();
      const equivalentNumber = Number(gradeEquivalent);
      const isDeansListCandidate =
        String(activeTerm).toLowerCase() === "finals" &&
        Number.isFinite(equivalentNumber) &&
        equivalentNumber > 0 &&
        equivalentNumber <= 1.75 &&
        !["dropped", "unofficially_dropped", "withdrawn", "incomplete"].includes(normalizedStanding);

      return {
        id: studentId,
        recordId: record.recordId || record.id || "",
        name:
          student.fullName ||
          `${student.lastName || ""}, ${student.firstName || ""}`.replace(
            /^,\s*/,
            ""
          ) ||
          student.studentId ||
          "-",
        lastName: student.lastName || "",
        firstName: student.firstName || "",
        middleName: student.middleName || "",
        midterm: record.midterm || "-",
        finals: record.finals || "-",
        referenceGrade: referenceRecord.grade || referenceRecord.midterm ||
          (String(activeTerm).toLowerCase() === 'finals' ? record.midterm : "-"),
        finalAverage,
        gradeEquivalent,
        standing,
        isDeansListCandidate,
        flagged: !!record.flagged,
        status: computeGradeStatus(record, activeTerm),
      };
    }).sort((left, right) => compareGradeReviewRows(left, right, activeTerm));
  }, [selectedSection, activeTerm]);

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        const normalizedStanding = String(row.standing || "").toLowerCase();
        const normalizedStatus = String(row.status || "").toLowerCase();

        if (normalizedStatus === "passed") acc.passed += 1;
        if (normalizedStatus === "failed") acc.failed += 1;

        if (normalizedStanding === "dropped") acc.d += 1;
        if (normalizedStanding === "unofficially_dropped") acc.ud += 1;
        if (normalizedStanding === "withdrawn") acc.w += 1;
        if (normalizedStanding === "incomplete") acc.inc += 1;
        if (row.flagged) acc.flagged += 1;

        return acc;
      },
      {
        passed: 0,
        failed: 0,
        d: 0,
        ud: 0,
        w: 0,
        inc: 0,
        flagged: 0,
      }
    );
  }, [rows]);

  if (!selectedSection) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
        <h3 className="text-xl font-semibold text-[#003366]">Section Review Panel</h3>
        
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {onBack ? <BackButton onClick={onBack} label="Back to Sections" /> : null}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-bold text-blue-900">
              Attached Grading Sheet (IPFS Vault)
            </h3>
            <p className="mt-1 text-sm text-blue-700">
              {selectedSection.ipfsCid
                ? `Open the encrypted grading sheet attached for ${selectedSection.sectionName}.`
                : `No IPFS attachment was found for ${selectedSection.sectionName} yet.`}
            </p>
          </div>

          <button
            type="button"
            onClick={() => selectedSection.ipfsCid && onViewIpfs?.(selectedSection.ipfsCid)}
            disabled={!selectedSection.ipfsCid}
            className={`rounded-xl px-5 py-2.5 text-sm font-bold shadow-sm transition ${
              selectedSection.ipfsCid
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-slate-300 text-slate-600"
            }`}
          >
            {selectedSection.ipfsCid ? "Decrypt & View" : "Unavailable"}
          </button>
        </div>
      </div>

      <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-xl font-bold text-[#003366]">Section Review Details</h3>
            <p className="mt-1 text-sm text-slate-500">
              {selectedSection.facultyName} • {selectedSection.sectionName} •{" "}
              {selectedSection.semester} • {getEncodingTermLabel(activeTerm)}
            </p>
          </div>

          <StatusBadge status={selectedSection.reviewStatus}
            className={`inline-flex w-fit rounded-full px-4 py-2 text-sm font-semibold ${getReviewStatusClasses(
              selectedSection.reviewStatus
            )}`}
          >
            {getReviewStatusLabel(selectedSection.reviewStatus)}
          </StatusBadge>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Department</p>
            <p className="mt-1 font-semibold text-slate-800">{selectedSection.department}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Students</p>
            <p className="mt-1 font-semibold text-slate-800">{selectedSection.totalStudents}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Encoded</p>
            <p className="mt-1 font-semibold text-slate-800">
              {selectedSection.encodedCount} / {selectedSection.totalStudents}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Progress</p>
            <p className="mt-1 font-semibold text-slate-800">{selectedSection.progress}%</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
          <div className="rounded-xl bg-emerald-50 p-4">
            <p className="text-sm text-emerald-700">Passed</p>
            <p className="mt-1 font-semibold text-emerald-900">{summary.passed}</p>
          </div>
          <div className="rounded-xl bg-rose-50 p-4">
            <p className="text-sm text-rose-700">Failed</p>
            <p className="mt-1 font-semibold text-rose-900">{summary.failed}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">D</p>
            <p className="mt-1 font-semibold text-slate-800">{summary.d}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">UD</p>
            <p className="mt-1 font-semibold text-slate-800">{summary.ud}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">W</p>
            <p className="mt-1 font-semibold text-slate-800">{summary.w}</p>
          </div>
          <div className="rounded-xl bg-amber-50 p-4">
            <p className="text-sm text-amber-700">INC</p>
            <p className="mt-1 font-semibold text-amber-900">{summary.inc}</p>
          </div>
          <div className="rounded-xl bg-red-50 p-4">
            <p className="text-sm text-red-700">Flagged</p>
            <p className="mt-1 font-semibold text-red-900">{summary.flagged}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-bold text-[#003366]">Grade Comparison</h3>
            <p className="text-sm text-slate-500">Rows are ranked by the submitted grade from highest to lowest and remain aligned by authoritative Student ID.</p>
            {String(activeTerm).toLowerCase() === "finals" ? (
              <p className="mt-1 flex items-center gap-2 text-xs text-amber-800">
                <span className="h-3 w-3 rounded-sm bg-amber-200 ring-1 ring-amber-400" aria-hidden="true" />
                Highlighted names have a final grade in the Dean&apos;s List range (1.75 or better). Official eligibility still depends on all semester subjects.
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2" data-testid="grade-comparison-grid">
          <div className="min-w-0 overflow-x-auto rounded-lg border border-slate-200"><h4 className="sticky left-0 bg-[#003366] px-4 py-3 font-bold text-white">Current / Submitted</h4><table className="min-w-[680px] table-fixed text-sm"><thead className="bg-slate-100 text-left"><tr><th className="w-28 px-3 py-2">Student ID</th><th className="w-48 px-3 py-2">Student</th><th className="w-24 px-3 py-2">{getEncodingTermLabel(activeTerm)}</th><th className="w-28 px-3 py-2">Status</th><th className="w-32 px-3 py-2">Ledger History</th></tr></thead><tbody>{rows.map((row) => <tr key={`current-${row.id}`} className={`border-t ${row.flagged ? 'bg-red-50' : ''}`}><td className="break-words px-3 py-2 font-mono text-xs">{row.id}</td><td className="break-words px-3 py-2 font-medium"><span data-deans-list-candidate={row.isDeansListCandidate ? "true" : "false"} title={row.isDeansListCandidate ? "Dean's List grade-range candidate" : undefined} className={row.isDeansListCandidate ? "rounded bg-amber-200 px-1.5 py-0.5 font-bold text-amber-950 ring-1 ring-amber-400" : ""}>{row.name}</span></td><td className="px-3 py-2 font-semibold">{String(activeTerm).toLowerCase() === 'finals' ? row.finals : row.midterm}</td><td className="break-words px-3 py-2 capitalize">{String(row.status).replaceAll('_', ' ')}</td><td className="px-3 py-2">{selectedSection.reviewStatus === 'forwarded' && row.recordId ? <GradeVersionHistory recordId={row.recordId} allowCorrection /> : <span className="text-xs text-slate-400">Not yet finalized</span>}</td></tr>)}</tbody></table></div>
          <div className="min-w-0 overflow-x-auto rounded-lg border border-slate-200"><h4 className="sticky left-0 bg-slate-700 px-4 py-3 font-bold text-white">Comparison / Reference</h4><table className="min-w-[560px] table-fixed text-sm"><thead className="bg-slate-100 text-left"><tr><th className="w-28 px-3 py-2">Student ID</th><th className="w-48 px-3 py-2">Student</th><th className="w-24 px-3 py-2">Reference</th><th className="w-28 px-3 py-2">Standing</th></tr></thead><tbody>{rows.map((row) => <tr key={`reference-${row.id}`} className="border-t"><td className="break-words px-3 py-2 font-mono text-xs">{row.id}</td><td className="break-words px-3 py-2 font-medium"><span data-deans-list-candidate={row.isDeansListCandidate ? "true" : "false"} title={row.isDeansListCandidate ? "Dean's List grade-range candidate" : undefined} className={row.isDeansListCandidate ? "rounded bg-amber-200 px-1.5 py-0.5 font-bold text-amber-950 ring-1 ring-amber-400" : ""}>{row.name}</span></td><td className="px-3 py-2 font-semibold">{row.referenceGrade}</td><td className="break-words px-3 py-2 capitalize">{String(row.standing).replaceAll('_', ' ')}</td></tr>)}</tbody></table></div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h3 className="text-lg font-bold text-[#003366]">Chairperson Decision</h3>
        

        <div className="mt-4">
          <label className="mb-2 block text-sm font-medium text-slate-700">Review Note</label>
          <textarea
            value={note}
            onChange={(event) => {
              if (!selectedSection) return;

              setDraftNotes((prev) => ({
                ...prev,
                [selectedSection.reviewKey]: event.target.value,
              }));
            }}
            placeholder="Enter the discrepancy, correction request, or approval remark here..."
            className="min-h-[120px] w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#003366]"
          />
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            onClick={() => onSendBack(note)}
            disabled={!note.trim() || selectedSection.reviewStatus === "forwarded" || selectedSection.sentToRegistrar}
            className="min-h-10 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Send Back to Faculty
          </button>
          <button
            onClick={() => {
              setApproveError("");
              setApproveConfirmationOpen(true);
            }}
            disabled={selectedSection.reviewStatus !== "submitted" || isApproving}
            className="min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isApproving ? "Approving…" : "Approve Section"}
          </button>
          {(selectedSection.reviewStatus === "approved" || selectedSection.reviewStatus === "forwarded") && <button
            onClick={() => {
              setHandoffError("");
              setHandoffConfirmationOpen(true);
            }}
            disabled={!onSendToRegistrar || !selectedSection.canSendToRegistrar || isSendingToRegistrar}
            className="min-h-10 rounded-lg bg-[#003366] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#00264d] disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Send to Registrar
          </button>}
        </div>
      </div>

      <Modal
        isOpen={approveConfirmationOpen}
        onClose={() => { if (!isApproving) setApproveConfirmationOpen(false); }}
        title="Approve Grades"
        description="Are you sure you want to approve these grades? Once approved, they can be sent to the Registrar for finalization."
        closeOnBackdrop={!isApproving}
        closeOnEscape={!isApproving}
      >
        {approveError && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{approveError}</p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => setApproveConfirmationOpen(false)} disabled={isApproving} className="min-h-11 rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003366] disabled:cursor-not-allowed disabled:opacity-60">Cancel</button>
          <button type="button" onClick={confirmApprove} disabled={isApproving} className="min-h-11 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400">{isApproving ? "Approving…" : "Approve Grades"}</button>
        </div>
      </Modal>

      {onSendToRegistrar ? <Modal
        isOpen={handoffConfirmationOpen}
        onClose={() => { if (!isSendingToRegistrar) setHandoffConfirmationOpen(false); }}
        title="Send to Registrar"
        description="Send this approved section to the Registrar Finalize queue? The approved grade values will not be changed."
        closeOnBackdrop={!isSendingToRegistrar}
        closeOnEscape={!isSendingToRegistrar}
      >
        {handoffError && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{handoffError}</p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => setHandoffConfirmationOpen(false)} disabled={isSendingToRegistrar} className="min-h-11 rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003366] disabled:cursor-not-allowed disabled:opacity-60">Cancel</button>
          <button type="button" onClick={confirmHandoff} disabled={isSendingToRegistrar} className="min-h-11 rounded-xl bg-[#003366] px-5 py-2.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003366] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400">Send to Registrar</button>
        </div>
      </Modal> : null}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h3 className="text-lg font-bold text-[#003366]">Decision Log</h3>
        

        <div className="mt-4 space-y-3">
          {(selectedSection.reviewLogs || []).length ? (
            [...selectedSection.reviewLogs].reverse().map((log, index) => (
              <div
                key={`${log.timestamp}-${index}`}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <StatusBadge status={log.status}
                    className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${getReviewStatusClasses(
                      log.status
                    )}`}
                  >
                    {getReviewStatusLabel(log.status)}
                  </StatusBadge>
                  <p className="text-xs text-slate-500">
                    {formatLogDate(log.timestamp)}
                  </p>
                </div>
                <p className="mt-2 text-sm font-semibold text-slate-700">
                  {log.actor || "Chairperson"}
                </p>
                {log.note ? (
                  <p className="mt-1 text-sm text-slate-600">{log.note}</p>
                ) : (
                  <p className="mt-1 text-sm text-slate-400">No note added.</p>
                )}
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-500">
              No chairperson decision has been recorded yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SectionReviewPanel;
