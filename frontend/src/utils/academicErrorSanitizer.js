export const isTechnicalAcademicError = (message) => {
  if (!message) return false;
  const s = String(message);
  return /23502|23503|23505|23514|year_level|academic_section_id|grade_submission_snapshots|pending_grade_records|facultysections|academicsections|Postgre?SQL|Npgsql|PostgresException|violates not-null constraint|null value in column|column .* of relation|Fabric|endorsement|chaincode|ledger-service|gRPC|FinalizeApprovedGradesAsync|assignment_cycle_id|HTTP 500|NullReferenceException|InvalidOperationException|System\./i.test(s);
};

export const sanitizeAcademicErrorMessage = (errOrMessage, fallback = 'Unable to complete this request right now. Your data was preserved. Please refresh and try again.') => {
  if (!errOrMessage) return fallback;
  const code = errOrMessage?.code || errOrMessage?.data?.code;
  const rawMsg = errOrMessage?.message || (typeof errOrMessage === 'string' ? errOrMessage : '');

  if (code === 'FINALIZATION_METADATA_INCOMPLETE') {
    return 'Unable to finalize this section because some academic information is incomplete. No approved grades were lost. Please refresh and try again.';
  }
  if (code === 'SUBMISSION_METADATA_INCOMPLETE') {
    return 'Unable to submit this section because some academic information is incomplete. Please refresh and try again.';
  }
  if (code === 'FINALIZATION_STATE_CHANGED') {
    return 'This section was updated while you were working. Please refresh the page before trying again.';
  }
  if (code === 'FINALIZATION_LEDGER_UNAVAILABLE') {
    return 'The grades could not be finalized right now. Your approved grades were preserved. Please try again.';
  }
  if (code === 'FINALIZATION_RECONCILIATION_REQUIRED') {
    return 'This section requires reconciliation before it can be finalized. No approved grades were lost.';
  }
  if (code === 'FINALIZATION_ARCHIVE_PENDING') {
    return 'Grades were finalized successfully, but the grading sheet is still being prepared. You can retry the document attachment without finalizing the grades again.';
  }
  if (code === 'SECTION_SUBMISSION_FAILED') {
    return 'Unable to submit this section right now. Your encoded grades were preserved. Please refresh and try again.';
  }

  if (isTechnicalAcademicError(rawMsg)) {
    if (/23502|null value in column|year_level|academic_section_id|grade_submission_snapshots/i.test(rawMsg)) {
      if (/submit/i.test(rawMsg)) {
        return 'Some academic information for this section is incomplete. Your encoded grades were preserved. Please refresh and try again.';
      }
      return 'Unable to finalize this section because some academic information is incomplete. No approved grades were lost. Please refresh and try again.';
    }
    if (/Fabric|peer|endorsement|chaincode|ledger-service|gRPC/i.test(rawMsg)) {
      return 'The grades could not be finalized right now. Your approved grades were preserved. Please try again.';
    }
    return fallback;
  }

  return rawMsg || fallback;
};
