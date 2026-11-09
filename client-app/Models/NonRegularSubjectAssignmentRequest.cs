namespace Client_app.Models;

public sealed class NonRegularSubjectAssignmentRequest
{
    public List<int> StudentUserIds { get; set; } = new();
    public List<NonRegularSubjectSelection> Selections { get; set; } = new();
}

public sealed class NonRegularSubjectSelection
{
    public long SubjectId { get; set; }
    public int? FacultySectionId { get; set; }
    public int? AcademicSectionId { get; set; }
    public string? Section { get; set; }
    public string? OverrideReason { get; set; }
}
