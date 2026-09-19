using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Npgsql;
using For_Testing_Only_Capstone.Models;
using System;
using System.Collections.Generic;
using System.IO;
using ClosedXML.Excel;
using System.Text.Json;
using System.Threading.Tasks;
using Client_app.Services;

namespace Client_app.Controllers
{
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class GradeTemplateController : ControllerBase
    {
        private readonly string _writeConnectionString;
        private readonly string _readConnectionString;

        public GradeTemplateController(IConfiguration configuration)
        {
            _writeConnectionString = configuration.GetConnectionString("MasterConnection") ?? configuration.GetConnectionString("PostgresConnection") ?? throw new InvalidOperationException("Database connection string not found.");
            _readConnectionString = configuration.GetConnectionString("ReplicaConnection") ?? configuration.GetConnectionString("PostgresConnection") ?? throw new InvalidOperationException("Database connection string not found.");
        }

        [HttpPost("create")]
        public async Task<IActionResult> CreateTemplate([FromBody] CreateTemplateRequest request)
        {
            if (string.IsNullOrEmpty(request.TemplateName) || string.IsNullOrEmpty(request.Department))
                return BadRequest(new { status = "Error", message = "Template name and target department are required." });

            try
            {
                using var conn = new NpgsqlConnection(_writeConnectionString);
                await conn.OpenAsync();

                string query = @"
                    INSERT INTO GradeTemplates (template_name, department, formula_config, status, created_at)
                    VALUES (@name, @dept, @config, 'Pending', @time) RETURNING id";
                
                using var cmd = new NpgsqlCommand(query, conn);
                cmd.Parameters.AddWithValue("name", request.TemplateName);
                cmd.Parameters.AddWithValue("dept", request.Department);
                cmd.Parameters.AddWithValue("config", JsonSerializer.Serialize(request.FormulaConfig));
                cmd.Parameters.AddWithValue("time", DateTime.UtcNow);

                int newId = (int)(await cmd.ExecuteScalarAsync() ?? 0);

                return Ok(new { status = "Success", message = $"Template created successfully and is pending approval from the {request.Department} department.", templateId = newId });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = $"Database error: {ex.Message}" });
            }
        }

        [HttpGet("department/{department}")]
        public async Task<IActionResult> GetDepartmentTemplates(string department)
        {
            try
            {
                using var conn = new NpgsqlConnection(_readConnectionString);
                await conn.OpenAsync();

                var templates = new List<object>();
                using var cmd = new NpgsqlCommand("SELECT id, template_name, formula_config, status, created_at FROM GradeTemplates WHERE department = @dept", conn);
                cmd.Parameters.AddWithValue("dept", department);

                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    templates.Add(new {
                        id = reader.GetInt32(0),
                        templateName = reader.GetString(1),
                        formulaConfig = JsonDocument.Parse(reader.GetString(2)),
                        status = reader.GetString(3),
                        createdAt = reader.GetDateTime(4)
                    });
                }

                return Ok(new { status = "Success", templates });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPut("{id}/review")]
        public async Task<IActionResult> ReviewTemplate(int id, [FromBody] ReviewTemplateRequest request)
        {
            if (request.Status != "Approved" && request.Status != "Rejected")
                return BadRequest(new { status = "Error", message = "Status must be either 'Approved' or 'Rejected'." });

            try
            {
                using var conn = new NpgsqlConnection(_writeConnectionString);
                await conn.OpenAsync();

                using var cmd = new NpgsqlCommand("UPDATE GradeTemplates SET status = @status WHERE id = @id", conn);
                cmd.Parameters.AddWithValue("status", request.Status);
                cmd.Parameters.AddWithValue("id", id);

                int rows = await cmd.ExecuteNonQueryAsync();
                if (rows == 0) return NotFound(new { status = "Error", message = "Template not found." });

                return Ok(new { status = "Success", message = $"Template has been {request.Status.ToLower()}." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpGet("faculty-section/{facultySectionId:int}/download")]
        public async Task<IActionResult> DownloadGradingSheet(int facultySectionId)
        {
            try
            {
                using var conn = new NpgsqlConnection(_readConnectionString);
                await conn.OpenAsync();
                var resolution = await FacultyAssignmentRosterService.ResolveAsync(
                    conn, facultySectionId, false, HttpContext.RequestAborted);
                if (resolution.Status == FacultyAssignmentRosterService.ResolutionStatus.NotFound)
                    return NotFound(new { status = "Error", message = resolution.Message });
                if (resolution.Status == FacultyAssignmentRosterService.ResolutionStatus.AmbiguousLegacy)
                    return Conflict(new { status = "Ambiguous", message = resolution.Message });
                if (resolution.Value is null)
                    return BadRequest(new { status = "Error", message = resolution.Message });
                var assignment = resolution.Value;
                if (User.IsInRole("faculty") &&
                    !string.Equals(User.Identity?.Name, assignment.FacultyEmail, StringComparison.OrdinalIgnoreCase))
                    return Forbid();

                var students = await FacultyAssignmentRosterService.GetRosterAsync(
                    conn, assignment, HttpContext.RequestAborted);

                var content = FacultyGradeWorkbookService.Build(assignment, students);
                string safeSection = string.Join("_", assignment.CanonicalSection.Split(Path.GetInvalidFileNameChars()));
                return File(content, FacultyGradeWorkbookService.ContentType,
                    $"{assignment.Subject}_{safeSection}_{assignment.SchoolYear}_{assignment.Semester}.xlsx");
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = $"Excel generation failed: {ex.Message}" });
            }
        }
    }

    public class CreateTemplateRequest
    {
        public string TemplateName { get; set; } = string.Empty;
        public string Department { get; set; } = string.Empty;
        public object FormulaConfig { get; set; } = new object();
    }

    public class ReviewTemplateRequest
    {
        public string Status { get; set; } = string.Empty; // "Approved" or "Rejected"
    }

    // --- JSON Mapping Classes ---
    public class FormulaConfig
    {
        public List<TemplateColumn> Columns { get; set; } = new List<TemplateColumn>();
    }

    public class TemplateColumn
    {
        public string Id { get; set; } = string.Empty; // e.g. "C", "D"
        public string Header { get; set; } = string.Empty;
        public string Type { get; set; } = string.Empty; // "input" or "formula"
        public string Value { get; set; } = string.Empty; // e.g. "=(C{row}*0.5) + (D{row}*0.5)"
    }

    public class StudentRow 
    {
        public string FullName { get; set; } = string.Empty;
        public string StudentNo { get; set; } = string.Empty;
    }
}
