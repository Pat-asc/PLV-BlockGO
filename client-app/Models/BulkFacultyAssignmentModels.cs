namespace Client_app.Models
{
    public sealed class BulkFacultyAssignmentsRequest
    {
        public List<BulkFacultyAssignmentItemRequest> Assignments { get; set; } = new();
    }

    public sealed class BulkFacultyAssignmentItemRequest
    {
        public string ClientId { get; set; } = string.Empty;
        public int FacultyUserId { get; set; }
        public string SubjectCode { get; set; } = string.Empty;
        public int AcademicSectionId { get; set; }
        public string SchoolYear { get; set; } = string.Empty;
        public string Semester { get; set; } = string.Empty;
    }
}
