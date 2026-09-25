using ClosedXML.Excel;

namespace Client_app.Services;

public static class FacultyGradeWorkbookService
{
    public const string ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    public static byte[] Build(
        FacultyAssignmentRosterService.Assignment assignment,
        IReadOnlyList<FacultyAssignmentRosterService.RosterStudent> students)
    {
        using var workbook = new XLWorkbook();
        var ws = workbook.Worksheets.Add("Grade Encoding");
        var headers = new[] {
            "Student ID", "Student Name", "Quizzes (20%)", "Assignments (10%)",
            "Attendance (10%)", "Midterm Exam (60%)", "Midterm Grade",
            "Final Quizzes (20%)", "Final Assignments (10%)", "Final Attendance (10%)",
            "Final Exam (60%)", "Final Grade", "Final Average", "Subject Code",
            "Section", "School Year", "Semester"
        };
        for (var column = 0; column < headers.Length; column++)
            ws.Cell(1, column + 1).Value = headers[column];
        for (var index = 0; index < students.Count; index++)
        {
            var row = index + 2;
            ws.Cell(row, 1).Value = students[index].StudentNo;
            ws.Cell(row, 2).Value = students[index].FullName;
            ws.Cell(row, 7).FormulaA1 = $"ROUND((C{row}*20%)+(D{row}*10%)+(E{row}*10%)+(F{row}*60%),2)";
            ws.Cell(row, 12).FormulaA1 = $"ROUND((H{row}*20%)+(I{row}*10%)+(J{row}*10%)+(K{row}*60%),2)";
            ws.Cell(row, 13).FormulaA1 = $"ROUND(AVERAGE(G{row},L{row}),2)";
            ws.Cell(row, 14).Value = assignment.Subject;
            ws.Cell(row, 15).Value = assignment.CanonicalSection;
            ws.Cell(row, 16).Value = assignment.SchoolYear;
            ws.Cell(row, 17).Value = assignment.Semester;
        }
        ws.Columns().AdjustToContents();
        ws.Range(1, 1, 1, headers.Length).Style.Font.Bold = true;
        ws.SheetView.FreezeRows(1);

        var metadata = workbook.Worksheets.Add("Assignment");
        metadata.Cell("A1").Value = "Faculty Section ID"; metadata.Cell("B1").Value = assignment.Id;
        metadata.Cell("A2").Value = "Subject Code"; metadata.Cell("B2").Value = assignment.Subject;
        metadata.Cell("A3").Value = "Section"; metadata.Cell("B3").Value = assignment.CanonicalSection;
        metadata.Cell("A4").Value = "School Year"; metadata.Cell("B4").Value = assignment.SchoolYear;
        metadata.Cell("A5").Value = "Semester"; metadata.Cell("B5").Value = assignment.Semester;
        metadata.Visibility = XLWorksheetVisibility.VeryHidden;

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }

    public static decimal WeightedGrade(decimal quizzes, decimal assignments, decimal attendance, decimal exam) =>
        decimal.Round((quizzes * .20m) + (assignments * .10m) + (attendance * .10m) + (exam * .60m), 2);
}
