namespace Client_app.Models;

public sealed class NonRegularSubjectAssignmentRequest
{
    public List<NonRegularSubjectSelection> Selections { get; set; } = new();
}

public sealed class NonRegularSubjectSelection
{
    public long SubjectId { get; set; }
    public int FacultySectionId { get; set; }
    public string? OverrideReason { get; set; }
}
