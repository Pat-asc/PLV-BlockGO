using ClosedXML.Excel;

namespace Client_app.Services;

public static class FacultyGradeWorkbookService
{
    public const string ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    public const string GradeSheetName = "Grade Encoding";
    public const string AssignmentSheetName = "Assignment";
    public static readonly string[] Headers = {
        "Student ID", "Student Name", "Quizzes (20%)", "Assignments (10%)",
        "Attendance (10%)", "Midterm Exam (60%)", "Midterm Grade",
        "Final Quizzes (20%)", "Final Assignments (10%)", "Final Attendance (10%)",
        "Final Exam (60%)", "Final Grade", "Final Average", "Subject Code",
        "Section", "School Year", "Semester"
    };

    public sealed record ParsedRow(int RowNumber, IReadOnlyDictionary<string, string> Values);
    public sealed record ParsedWorkbook(int FacultySectionId, IReadOnlyList<ParsedRow> Rows);

    public static string NormalizeHeader(string value) =>
        System.Text.RegularExpressions.Regex.Replace(value.Trim().ToLowerInvariant(), @"[^a-z0-9]+", "_").Trim('_');

    public static byte[] Build(
        FacultyAssignmentRosterService.Assignment assignment,
        IReadOnlyList<FacultyAssignmentRosterService.RosterStudent> students)
    {
        using var workbook = new XLWorkbook();
        var ws = workbook.Worksheets.Add(GradeSheetName);
        for (var column = 0; column < Headers.Length; column++)
            ws.Cell(1, column + 1).Value = Headers[column];
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
        ws.Range(1, 1, 1, Headers.Length).Style.Font.Bold = true;
        ws.SheetView.FreezeRows(1);

        var metadata = workbook.Worksheets.Add(AssignmentSheetName);
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

    public static ParsedWorkbook Parse(Stream stream)
    {
        using var workbook = new XLWorkbook(stream);
        if (!workbook.TryGetWorksheet(GradeSheetName, out var sheet))
            throw new ArgumentException($"The '{GradeSheetName}' worksheet is missing. Download a fresh grading sheet.");
        if (!workbook.TryGetWorksheet(AssignmentSheetName, out var assignmentSheet) ||
            !int.TryParse(assignmentSheet.Cell("B1").GetString(), out var facultySectionId))
            throw new ArgumentException("The workbook is not tied to an exact Faculty assignment. Download a fresh grading sheet.");

        var headerRow = sheet.FirstRowUsed() ?? throw new ArgumentException("No data found in Excel sheet.");
        var headerMap = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var lastColumn = headerRow.LastCellUsed()?.Address.ColumnNumber ?? 0;
        for (var column = headerRow.FirstCellUsed()?.Address.ColumnNumber ?? 1; column <= lastColumn; column++)
        {
            var normalized = NormalizeHeader(headerRow.Cell(column).GetString());
            if (string.IsNullOrEmpty(normalized))
                throw new ArgumentException($"The Excel heading in column {column} is blank.");
            if (!headerMap.TryAdd(normalized, column))
                throw new ArgumentException($"Duplicate Excel heading '{normalized}' is not allowed.");
        }
        if (!headerMap.Keys.Any(value => value is "student_id" or "student_no" or "id_number" or "student_number"))
            throw new ArgumentException("A Student ID or Student Number heading is required.");

        static string CellText(IXLCell cell)
        {
            try { return (cell.HasFormula ? cell.CachedValue.ToString() : cell.Value.ToString()).Trim(); }
            catch { return cell.Value.ToString().Trim(); }
        }

        var rows = new List<ParsedRow>();
        var studentIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in sheet.RowsUsed().Where(row => row.RowNumber() > headerRow.RowNumber()))
        {
            var values = headerMap.ToDictionary(pair => pair.Key, pair => CellText(row.Cell(pair.Value)),
                StringComparer.OrdinalIgnoreCase);
            var studentId = new[] { "student_id", "student_no", "id_number", "student_number" }
                .Select(key => values.TryGetValue(key, out var value) ? value : string.Empty)
                .FirstOrDefault(value => !string.IsNullOrWhiteSpace(value)) ?? string.Empty;
            var hasAnyValue = values.Values.Any(value => !string.IsNullOrWhiteSpace(value));
            if (string.IsNullOrWhiteSpace(studentId))
            {
                if (hasAnyValue) throw new ArgumentException($"Row {row.RowNumber()} — Student ID is required.");
                continue;
            }
            if (!studentIds.Add(studentId))
                throw new ArgumentException($"Row {row.RowNumber()} — duplicate Student ID {studentId}.");

            foreach (var key in new[] { "quizzes_20", "assignments_10", "attendance_10", "midterm_exam_60", "midterm_grade",
                         "final_quizzes_20", "final_assignments_10", "final_attendance_10", "final_exam_60", "final_grade", "final_average" })
            {
                if (!values.TryGetValue(key, out var value) || string.IsNullOrWhiteSpace(value)) continue;
                if (row.Cell(headerMap[key]).HasFormula) continue;
                if (!decimal.TryParse(value, System.Globalization.NumberStyles.Number,
                        System.Globalization.CultureInfo.InvariantCulture, out var number) || number is < 0 or > 100)
                    throw new ArgumentException($"Row {row.RowNumber()} — '{headerRow.Cell(headerMap[key]).GetString()}' must be a number from 0 to 100.");
            }
            rows.Add(new(row.RowNumber(), values));
        }
        return new(facultySectionId, rows);
    }
}
