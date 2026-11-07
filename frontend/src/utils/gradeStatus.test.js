import {
  GRADE_STATUS,
  isChairpersonForwardedGradeStatus,
  isDepartmentApprovedGradeStatus,
  isRegistrarReviewGradeStatus,
  normalizeGradeStatus,
} from "./gradeStatus";

describe("grade workflow status helpers", () => {
  test.each(["Draft", "Returned", "SubmittedToChairperson", "ChairpersonApproved"])(
    "%s is not visible in the registrar commit queue",
    (status) => {
      expect(isDepartmentApprovedGradeStatus(status)).toBe(false);
      expect(isChairpersonForwardedGradeStatus(status)).toBe(false);
    }
  );

  test.each(["DepartmentApproved", "Forwarded", "ForwardedToRegistrar"])(
    "%s is visible in the registrar commit queue",
    (status) => {
      expect(isDepartmentApprovedGradeStatus(status)).toBe(true);
      expect(isChairpersonForwardedGradeStatus(status)).toBe(true);
    }
  );

  test("chairperson approval remains an approved review state", () => {
    expect(normalizeGradeStatus("ChairpersonApproved")).toBe(GRADE_STATUS.APPROVED);
  });

  test("direct Faculty submission is visible in Registrar review", () => {
    expect(isRegistrarReviewGradeStatus("SubmittedToRegistrar")).toBe(true);
    expect(isRegistrarReviewGradeStatus("SubmittedToChairperson")).toBe(false);
  });
});
