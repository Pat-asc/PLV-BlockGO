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
	if record.Version != 5 {
		t.Fatalf("approval and finalization must each create one version, got %d", record.Version)
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
