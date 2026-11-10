import {
  areProgramsEquivalent,
  buildCsvContent,
  buildStudentCsvContent,
  consolidateSectioningBatches,
  downloadCsvFile,
  getCanonicalProgramName,
  getGregorianCalendarYear,
  getNextStudentId,
  parseCsvRows,
  parseStudentIdSpreadsheet,
} from "./studentSectioningHelpers";

describe("studentSectioningHelpers", () => {
  it("resolves canonical program names and verifies program equivalence", () => {
    expect(getCanonicalProgramName("BAC")).toBe("Bachelor of Arts in Communication");
    expect(getCanonicalProgramName("bac")).toBe("Bachelor of Arts in Communication");
    expect(getCanonicalProgramName("Bachelor of Arts in Communication")).toBe("Bachelor of Arts in Communication");
    expect(areProgramsEquivalent("BAC", "Bachelor of Arts in Communication")).toBe(true);
    expect(areProgramsEquivalent("bac", "BAC")).toBe(true);
    expect(areProgramsEquivalent("BSIT", "Bachelor of Science in Information Technology")).toBe(true);
    expect(areProgramsEquivalent("BSIT", "BAC")).toBe(false);
  });

  it("consolidates duplicate equivalent program batches, deduplicates students generically, and preserves existing removal records without synthetic injection", () => {
    const rawBatches = [
      {
        key: "BAC|2026-2027|1st Semester",
        program: "BAC",
        batchYear: "2026",
        schoolYear: "2026-2027",
        semester: "1st Semester",
        sectionPlans: [{ id: 9, academicSectionId: 9, yearLevel: "1st Year", sectionCode: "1-1" }],
        students: [
          { studentId: "26-0001", firstName: "Juan", lastName: "Dela Cruz", yearLevel: "1st Year", sectionCode: "1-1" },
          { studentId: "26-0003", firstName: "Mark", lastName: "Reyes", yearLevel: "1st Year", sectionCode: "1-1", isActive: false },
          { studentId: "26-0004", firstName: "Ana", lastName: "Lim", yearLevel: "1st Year", sectionCode: "1-1", status: "DROPPED" },
          { studentId: "26-0005", firstName: "Paul", lastName: "Tan", yearLevel: "1st Year", sectionCode: "1-1" },
        ],
        removedStudents: [
          {
            studentId: "26-0005",
            removalReason: "Duplicate student record",
            removalNote: "Duplicate student record",
            removedAt: "2026-11-10T08:00:00.000Z",
          },
        ],
      },
      {
        key: "Bachelor of Arts in Communication|2026-2027|1st Semester",
        program: "Bachelor of Arts in Communication",
        batchYear: "2026",
        schoolYear: "2026-2027",
        semester: "1st Semester",
        sectionPlans: [{ id: 9, academicSectionId: 9, yearLevel: "1st Year", sectionCode: "1-1" }],
        students: [
          { studentId: "26-0001", firstName: "Juan", lastName: "Dela Cruz", yearLevel: "1st Year", sectionCode: "1-1" },
          { studentId: "26-0002", firstName: "Maria", lastName: "Santos", yearLevel: "1st Year", sectionCode: "1-1" },
        ],
        removedStudents: [
          {
            studentId: "26-0005",
            removalReason: "Duplicate student record",
            removalNote: "Duplicate student record",
            removedAt: "2026-11-10T08:00:00.000Z",
          },
        ],
      },
    ];

    const consolidated = consolidateSectioningBatches(rawBatches);
    expect(consolidated).toHaveLength(1);
    expect(consolidated[0].program).toBe("Bachelor of Arts in Communication");
    expect(consolidated[0].students.map((s) => s.studentId)).toEqual(["26-0001", "26-0002"]);
    expect(consolidated[0].removedStudents).toHaveLength(1);
    expect(consolidated[0].removedStudents[0]).toMatchObject({
      studentId: "26-0005",
      removalReason: "Duplicate student record",
      removedAt: "2026-11-10T08:00:00.000Z",
    });
  });
  it("parses Excel CSV rows with quoted commas and CRLF line endings", () => {
    const csv =
      'Student ID,Sex,Last Name,First Name,Middle Name\r\n' +
      '26-0001,Male,"Dela, Cruz",Juan,A\r\n';

    expect(parseCsvRows(csv)).toEqual([
      ["Student ID", "Sex", "Last Name", "First Name", "Middle Name"],
      ["26-0001", "Male", "Dela, Cruz", "Juan", "A"],
    ]);
  });

  it("imports registrar template rows into student records", () => {
    const csv = buildStudentCsvContent(
      [
        {
          studentId: "26-0001",
          sex: "Male",
          lastName: "Dela Cruz",
          firstName: "Juan",
          middleName: "Andres",
          middleInitial: "A",
        },
      ],
      { includeYearLevel: false }
    );

    expect(parseStudentIdSpreadsheet(csv)).toEqual([
      {
        studentId: "26-0001",
        sex: "Male",
        lastName: "Dela Cruz",
        firstName: "Juan",
        middleName: "Andres",
        middleInitial: "Andres",
        yearLevel: "1st Year",
        sectionCode: "",
      },
    ]);
  });

  it("downloads a non-empty CSV template with the requested production-safe filename", () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURL = URL.createObjectURL = jest.fn(() => "blob:section-template");
    const revokeObjectURL = URL.revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadCsvFile(buildStudentCsvContent([{ studentId: "26-0001", sex: "Male", lastName: "Dela Cruz", firstName: "Juan", middleName: "Santos", yearLevel: "1st Year" }]), "bsit-1st-year-section-template.csv");
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:section-template");
    click.mockRestore();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("accepts common student number and middle name header aliases", () => {
    const csv =
      "student_no,gender,surname,given_name,middle_name,year\n" +
      "26-0002,Female,Santos,Maria,Luna,2nd Year\n";

    expect(parseStudentIdSpreadsheet(csv)[0]).toMatchObject({
      studentId: "26-0002",
      sex: "Female",
      lastName: "Santos",
      firstName: "Maria",
      middleName: "Luna",
      middleInitial: "Luna",
      yearLevel: "2nd Year",
    });
  });

  it("escapes generated CSV values that contain commas", () => {
    expect(buildCsvContent([["department"], ["Bachelor, Sample"]])).toBe(
      'department\n"Bachelor, Sample"'
    );
  });

  it("generates the first student ID from the selected four-digit year", () => {
    expect(getNextStudentId("2026", [])).toBe("26-0001");
    expect(getNextStudentId("2027-2028", [])).toBe("27-0001");
  });

  it("uses Gregorian leap years without changing the ID sequence format", () => {
    expect(getGregorianCalendarYear(new Date("2000-02-29T12:00:00Z"))).toBe(2000);
    expect(getGregorianCalendarYear(new Date("2024-02-29T12:00:00Z"))).toBe(2024);
    expect(getNextStudentId("2024", [])).toBe("24-0001");
  });

  it("increments the highest ID used for that year across active and removed students", () => {
    const batches = [
      {
        students: [
          { studentId: "26-0002" },
          { studentId: "27-0099" },
        ],
        removedStudents: [{ studentId: "26-0007" }],
      },
      { students: [{ studentId: "26-0004" }] },
    ];

    expect(getNextStudentId("2026", batches)).toBe("26-0008");
    expect(getNextStudentId("2027", batches)).toBe("27-0100");
  });

  it("continues after the highest ID already persisted by the backend", () => {
    const localBatches = [{ students: [{ studentId: "26-0052" }] }];

    expect(getNextStudentId("2026", [], 50)).toBe("26-0051");
    expect(getNextStudentId("2026", localBatches, 50)).toBe("26-0053");
  });

  it("does not generate an ID for an invalid year or reuse an exhausted prefix", () => {
    expect(getNextStudentId("26", [])).toBe("");
    expect(
      getNextStudentId("2026", [{ students: [{ studentId: "26-9999" }] }])
    ).toBe("");
  });
});
