package main

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

func testRecord(status, term, program string) AcademicRecord {
	return AcademicRecord{
		ID: "grade-1", StudentHash: "student@plv.edu.ph", StudentNo: "26-0001",
		StudentName: "Student One", Section: "BSIT 1-1", Program: program, Course: program,
		SubjectCode: "IT 101", Grade: `{"midterm":"88","finals":"92","finalAverage":"90"}`,
		SchoolYear: "2026-2027", Semester: "FIRST", Term: term, FacultyID: "faculty@plv.edu.ph",
		Status: status, Version: 3, AssignmentCycleID: "faculty-section-42",
	}
}

func TestChairpersonIdentityAuthorization(t *testing.T) {
	tests := []struct {
		name, mspID, role string
		allowed           bool
	}{
		{"canonical Chairperson", "DepartmentMSP", "department_admin", true},
		{"legacy Chairperson certificate", "DepartmentMSP", "deptAdmin", true},
		{"faculty", "FacultyMSP", "faculty", false},
		{"student", "RegistrarMSP", "student", false},
		{"registrar", "RegistrarMSP", "registrar", false},
		{"unknown role", "DepartmentMSP", "unknown", false},
		{"missing role", "DepartmentMSP", "", false},
		{"spoofed role in wrong MSP", "FacultyMSP", "department_admin", false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := isDepartmentAdminIdentity(test.mspID, test.role); actual != test.allowed {
				t.Fatalf("authorization = %v, want %v", actual, test.allowed)
			}
		})
	}
}

func TestRegistrarIsSoleLedgerFinalizer(t *testing.T) {
	if !isRegistrarIdentity("RegistrarMSP", "registrar") {
		t.Fatal("canonical Registrar identity was denied finalization")
	}
	for _, identity := range [][2]string{{"DepartmentMSP", "department_admin"}, {"FacultyMSP", "faculty"}, {"RegistrarMSP", "student"}} {
		if isRegistrarIdentity(identity[0], identity[1]) {
			t.Fatalf("non-Registrar identity %s/%s was allowed to finalize", identity[0], identity[1])
		}
	}
}

func TestApprovedSnapshotComparisonPreservesExactGradePayload(t *testing.T) {
	staged := testRecord(statusDepartmentApproved, "finals", "BSIT")
	ledger := staged
	if !sameApprovedGradeSnapshot(staged, ledger) {
		t.Fatal("identical approved and ledger snapshots did not match")
	}
	ledger.Grade = `{"midterm":"88","finals":"92","finalAverage":"90.00"}`
	if sameApprovedGradeSnapshot(staged, ledger) {
		t.Fatal("a reformatted grade payload was accepted as the exact approved snapshot")
	}
	ledger = staged
	ledger.StudentNo = "26-9999"
	if sameApprovedGradeSnapshot(staged, ledger) {
		t.Fatal("a grade associated with another Student ID was accepted")
	}
}

func TestChairpersonDepartmentScope(t *testing.T) {
	record := testRecord(statusDepartmentApproved, "midterm", "BSIT")
	if !departmentScopeAllows("BSIT", true, record) {
		t.Fatal("same-department Chairperson was denied")
	}
	if departmentScopeAllows("BECE", true, record) {
		t.Fatal("Chairperson was allowed to finalize another department's grade")
	}
	if departmentScopeAllows("BSIT", false, record) {
		t.Fatal("missing academic.department attribute was accepted")
	}
}

func TestFacultySectionScope(t *testing.T) {
	record := testRecord("Draft", "midterm", "BSIT")
	if !facultySectionScopeAllows("BSIT 1-2| bsit 1-1 ", true, record) {
		t.Fatal("correct Faculty section scope was denied")
	}
	if facultySectionScopeAllows("BSIT 1-2|BSIT 2-1", true, record) {
		t.Fatal("wrong Faculty section scope was allowed")
	}
	if facultySectionScopeAllows("BSIT 1-1", false, record) {
		t.Fatal("missing academic.sections attribute was accepted")
	}
}

func TestFacultyIssueAttributionCannotClaimAnotherFaculty(t *testing.T) {
	record := testRecord("Draft", "midterm", "BSIT")
	record.FacultyID = "another-faculty@plv.edu.ph"
	applyIssueAttribution(&record, "faculty", "signed-faculty@plv.edu.ph")
	if record.FacultyID != "signed-faculty@plv.edu.ph" || record.SubmittedBy != "signed-faculty@plv.edu.ph" {
		t.Fatalf("Faculty issue attribution was not bound to the signed actor: %+v", record)
	}
}

func TestChairpersonIssuePreservesCapturedFacultyAndAuditsSignedActor(t *testing.T) {
	record := testRecord(statusDepartmentApproved, "midterm", "BSIT")
	applyIssueAttribution(&record, "department_admin", "chair@plv.edu.ph")
	if record.FacultyID != "faculty@plv.edu.ph" {
		t.Fatalf("Chairperson issuance replaced the captured Faculty owner: %+v", record)
	}
	if record.SubmittedBy != "chair@plv.edu.ph" {
		t.Fatalf("Chairperson issuance did not audit the signed actor: %+v", record)
	}
}

func TestChairpersonFullApprovalAndFinalizationPath(t *testing.T) {
	record := testRecord(statusIssued, "finals", "BSIT")
	approved, err := transitionToDepartmentApproved(&record)
	if err != nil || !approved || record.Status != statusDepartmentApproved {
		t.Fatalf("approval failed: changed=%v status=%s err=%v", approved, record.Status, err)
	}
	finalizedAt := time.Date(2026, 9, 28, 4, 5, 6, 7, time.UTC)
	finalized, err := transitionToFinalized(&record, "chairperson@plv.edu.ph", finalizedAt)
	if err != nil || !finalized || record.Status != statusFinalized {
		t.Fatalf("finalization failed: changed=%v status=%s err=%v", finalized, record.Status, err)
	}
	if record.FinalizedBy != "chairperson@plv.edu.ph" || record.FinalizedAt != finalizedAt.Format(time.RFC3339Nano) {
		t.Fatalf("finalization audit fields are incorrect: %+v", record)
	}
	if record.GradeVersion != 1 || record.LogicalGradeID != record.ID {
		t.Fatalf("first finalized generation was not initialized as grade version 1: %+v", record)
	}
	if record.Version != 5 {
		t.Fatalf("approval and finalization must each create one version, got %d", record.Version)
	}
}

func TestFinalizedCorrectionCreatesLinkedVersionWithoutChangingIdentity(t *testing.T) {
	record := testRecord(statusFinalized, "midterm", "BSIT")
	record.GradeVersion = 1
	record.TransactionID = "tx-v1"
	original := record
	correctedAt := time.Date(2026, 10, 3, 7, 8, 9, 0, time.UTC)
	err := applyFinalizedCorrection(&record, FinalizedGradeCorrection{
		RecordID: record.ID, NewGrade: "88", Reason: "Incorrect final examination score encoded.", ExpectedGradeVersion: 1,
	}, "chair@plv.edu.ph", correctedAt)
	if err != nil {
		t.Fatalf("valid finalized correction failed: %v", err)
	}
	if record.GradeVersion != 2 || record.Grade != "88" || record.PreviousTxID != "tx-v1" {
		t.Fatalf("correction did not create a linked v2: %+v", record)
	}
	if record.StudentNo != original.StudentNo || record.SubjectCode != original.SubjectCode ||
		record.AssignmentCycleID != original.AssignmentCycleID || record.SchoolYear != original.SchoolYear ||
		record.Semester != original.Semester || record.Term != original.Term {
		t.Fatalf("correction changed logical grade identity: before=%+v after=%+v", original, record)
	}
}

func TestFinalizedCorrectionRequiresReasonAndCurrentVersion(t *testing.T) {
	for _, test := range []struct {
		name     string
		reason   string
		expected int
		want     string
	}{
		{"empty reason", " ", 1, "correction reason"},
		{"stale version", "Valid correction reason", 2, "version conflict"},
	} {
		t.Run(test.name, func(t *testing.T) {
			record := testRecord(statusFinalized, "finals", "BSIT")
			record.GradeVersion = 1
			original := record
			err := applyFinalizedCorrection(&record, FinalizedGradeCorrection{
				RecordID: record.ID, NewGrade: "90", Reason: test.reason, ExpectedGradeVersion: test.expected,
			}, "chair@plv.edu.ph", time.Now().UTC())
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q error, got %v", test.want, err)
			}
			if !reflect.DeepEqual(record, original) {
				t.Fatalf("rejected correction mutated the record: before=%+v after=%+v", original, record)
			}
		})
	}
}

func TestSecondFinalizedCorrectionCreatesVersionThree(t *testing.T) {
	record := testRecord(statusFinalized, "finals", "BSIT")
	record.GradeVersion = 2
	record.TransactionID = "tx-v2"
	err := applyFinalizedCorrection(&record, FinalizedGradeCorrection{
		RecordID: record.ID, NewGrade: "91", Reason: "Second verified correction", ExpectedGradeVersion: 2,
	}, "chair@plv.edu.ph", time.Now().UTC())
	if err != nil {
		t.Fatalf("second correction failed: %v", err)
	}
	if record.GradeVersion != 3 || record.PreviousTxID != "tx-v2" {
		t.Fatalf("second correction was not linked as v3: %+v", record)
	}
}

func TestLegacyFinalizedGradeReadsAsVersionOne(t *testing.T) {
	record := testRecord(statusFinalized, "midterm", "BSIT")
	record.GradeVersion = 0
	if version := finalizedGradeVersion(record); version != 1 {
		t.Fatalf("legacy finalized grade version = %d, want 1", version)
	}
}

func TestFinalizeRejectsApprovalBypassStates(t *testing.T) {
	for _, state := range []string{"Draft", "Submitted", "SubmittedToChairperson", "ChairpersonApproved", statusIssued, statusCorrected, statusReturned} {
		t.Run(state, func(t *testing.T) {
			record := testRecord(state, "midterm", "BSIT")
			changed, err := transitionToFinalized(&record, "chairperson@plv.edu.ph", time.Now())
			if changed || err == nil || !strings.Contains(err.Error(), "only department-approved grades") {
				t.Fatalf("state %s bypassed approval: changed=%v err=%v", state, changed, err)
			}
			if record.Status != state {
				t.Fatalf("denied transition mutated status to %s", record.Status)
			}
		})
	}
}

func TestFinalizePreservesGradeCycleAndTerm(t *testing.T) {
	for _, term := range []string{"midterm", "finals"} {
		t.Run(term, func(t *testing.T) {
			record := testRecord(statusDepartmentApproved, term, "BSIT")
			original := record
			changed, err := transitionToFinalized(&record, "chairperson@plv.edu.ph", time.Now().UTC())
			if err != nil || !changed {
				t.Fatalf("valid %s grade was not finalized: %v", term, err)
			}
			if record.Grade != original.Grade || record.AssignmentCycleID != original.AssignmentCycleID ||
				record.Term != original.Term || record.StudentHash != original.StudentHash ||
				record.SubjectCode != original.SubjectCode || record.SchoolYear != original.SchoolYear ||
				record.Semester != original.Semester || record.Section != original.Section {
				t.Fatalf("finalization changed authoritative grade identity: before=%+v after=%+v", original, record)
			}
		})
	}
}

func TestAlreadyFinalizedIsIdempotent(t *testing.T) {
	record := testRecord(statusFinalized, "finals", "BSIT")
	record.FinalizedBy = "original-chair@plv.edu.ph"
	record.FinalizedAt = "2026-09-27T01:02:03Z"
	original := record
	changed, err := transitionToFinalized(&record, "retrying-chair@plv.edu.ph", time.Now())
	if err != nil || changed {
		t.Fatalf("already-finalized retry was not idempotent: changed=%v err=%v", changed, err)
	}
	if !reflect.DeepEqual(record, original) {
		t.Fatalf("already-finalized retry mutated the record: before=%+v after=%+v", original, record)
	}
}
