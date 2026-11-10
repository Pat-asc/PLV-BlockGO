using Client_app.Services;
using Npgsql;

static void Check(bool condition, string message)
{
    if (!condition) throw new Exception(message);
}

// Use a disposable database. This executable creates its own schema and removes only that schema.
var connectionString = Environment.GetEnvironmentVariable("SECTIONING_TEST_CONNECTION")
    ?? throw new Exception("Set SECTIONING_TEST_CONNECTION to a disposable PostgreSQL database.");
await using var connection = new NpgsqlConnection(connectionString);
await connection.OpenAsync();
var schema = "sectioning_test_" + Guid.NewGuid().ToString("N");
async Task Execute(string sql)
{
    await using var command = new NpgsqlCommand(sql, connection);
    await command.ExecuteNonQueryAsync();
}
async Task<object?> Scalar(string sql)
{
    await using var command = new NpgsqlCommand(sql, connection);
    return await command.ExecuteScalarAsync();
}
async Task Reject(Func<Task> action, string message)
{
    try { await action(); }
    catch (InvalidOperationException) { return; }
    catch (KeyNotFoundException) { return; }
    throw new Exception(message);
}

await Execute($"CREATE SCHEMA {schema}; SET search_path TO {schema};");
try
{
    await Execute(@"
        CREATE TABLE users (id INT PRIMARY KEY, email TEXT, role TEXT DEFAULT 'student',
            status TEXT DEFAULT 'APPROVED', is_active BOOLEAN DEFAULT TRUE);
        CREATE TABLE academic_programs (program_id INT PRIMARY KEY, program_code TEXT, program_name TEXT);
        CREATE TABLE curriculums (curriculum_id BIGINT PRIMARY KEY);
        CREATE TABLE studentprofiles (user_id INT PRIMARY KEY REFERENCES users(id), student_no TEXT,
            full_name TEXT, student_email TEXT, department TEXT, year_level TEXT, section TEXT,
            assignment_status TEXT, sex TEXT, curriculum_id BIGINT, batch_year INT);");
    await Execute(await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "enrollment.sql")));
    await Execute(@"
        ALTER TABLE academicsections
            ADD COLUMN max_capacity INTEGER NOT NULL DEFAULT 40,
            ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
        ALTER TABLE student_enrollments
            ADD COLUMN batch_year INT,
            ADD COLUMN enrollment_state VARCHAR(20) NOT NULL DEFAULT 'PLANNING',
            ADD COLUMN finalized_at TIMESTAMPTZ,
            ADD COLUMN finalized_by INTEGER REFERENCES users(id);
        CREATE TABLE facultysections (
            id SERIAL PRIMARY KEY,
            academic_section_id INTEGER REFERENCES academicsections(id),
            school_year VARCHAR(20),
            semester VARCHAR(20),
            is_active BOOLEAN NOT NULL DEFAULT TRUE
        );");
    await Execute(await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "lookup.sql")));
    await Execute(@"
        INSERT INTO academic_programs VALUES (1, 'BSIT', 'Information Technology'), (2, 'BSCS', 'Computer Science');
        INSERT INTO academicsections (id, department, year_level, section_num) VALUES
            (1, 'Information Technology', 1, 1), (2, 'BSIT', 1, 2),
            (3, 'Computer Science', 1, 1), (4, 'BSIT', 2, 1);
        INSERT INTO users (id, email) SELECT n, 'student' || n || '@test.invalid' FROM generate_series(1, 10) n;
        INSERT INTO studentprofiles (user_id, student_no, full_name, department, year_level, section, assignment_status)
            SELECT id, '26-' || LPAD(id::text, 4, '0'), 'Test Student ' || id, 'stale program', '4', '4-9', 'Dropped' FROM users;
        INSERT INTO student_enrollments (student_user_id, student_no, program_id, school_year, semester, year_level)
            SELECT id, '26-' || LPAD(id::text, 4, '0'), 1, '2026-2027', 'FIRST', 1 FROM users WHERE id < 10;
        UPDATE student_enrollments SET status = 'DROPPED' WHERE student_user_id = 2;
        UPDATE student_enrollments SET status = 'WITHDRAWN' WHERE student_user_id = 3;
        UPDATE student_enrollments SET status = 'COMPLETED' WHERE student_user_id = 4;
        UPDATE student_enrollments SET academic_section_id = 2, section = '1-2' WHERE student_user_id = 5;
        UPDATE student_enrollments SET program_id = 2 WHERE student_user_id = 6;
        UPDATE student_enrollments SET year_level = 2 WHERE student_user_id = 7;
        UPDATE users SET is_active = FALSE WHERE id = 8;
        INSERT INTO student_enrollments (student_user_id, student_no, program_id, school_year, semester, year_level)
            VALUES (1, '26-0001', 1, '2026-2027', 'SECOND', 2), (1, '26-0001', 1, '2025-2026', 'FIRST', 1);");

    var eligible = await EnrollmentSectioningService.GetUnassignedAsync(connection, "BSIT", 1, "2026-2027", "FIRST", null);
    Check(eligible.Select(student => student.Id).SequenceEqual(new[] { 1, 9 }), "Picker must use enrollment status, year and program, ignoring stale profiles.");
    Check(eligible.All(student => student.AcademicSectionId == null && student.EnrollmentStatus == "ENROLLED" && student.EnrollmentId > 0), "Enrollment status/FK defaults incorrect.");
    Check((await EnrollmentSectioningService.GetUnassignedAsync(connection, "BSIT", null, "2026-2027", "SECOND", null)).Count == 1, "Semester filter ignored.");
    Check((await EnrollmentSectioningService.GetUnassignedAsync(connection, null, null, "2025-2026", null, null)).Count == 1, "School-year filter ignored.");
    Check((await EnrollmentSectioningService.GetUnassignedAsync(connection, "BSCS", null, null, null, "BSIT")).Count == 0, "Department scope leaked.");
    Check((await EnrollmentSectioningService.GetUnassignedAsync(connection, null, null, null, null, null)).Count == 6, "Unfiltered query must return all eligible enrollment periods.");

    await Reject(() => EnrollmentSectioningService.AssignAsync(connection, 1, new[] { "26-0001", "26-0002" }, "2026-2027", "FIRST", null), "Dropped student accepted.");
    Check(await Scalar("SELECT academic_section_id FROM student_enrollments WHERE student_user_id = 1 AND school_year = '2026-2027' AND semester = 'FIRST'") == DBNull.Value, "Failed request partially committed.");
    foreach (var student in new[] { "26-0002", "26-0003", "26-0004", "26-0005", "26-0006", "26-0007", "26-0008", "26-0010", "missing" })
        await Reject(() => EnrollmentSectioningService.AssignAsync(connection, 1, new[] { student }, "2026-2027", "FIRST", null), $"Invalid assignment accepted: {student}");
    await Reject(() => EnrollmentSectioningService.AssignAsync(connection, 1, new[] { "26-0009" }, "2025-2026", "FIRST", null), "Missing period fabricated an enrollment.");
    await Reject(() => EnrollmentSectioningService.AssignAsync(connection, 3, new[] { "26-0006" }, "2026-2027", "FIRST", "BSIT"), "Cross-department assignment allowed.");

    await Execute("INSERT INTO facultysections (academic_section_id, school_year, semester) VALUES (1, '2025-2026', 'FIRST');");
    await Reject(() => EnrollmentSectioningService.AssignAsync(connection, 1, new[] { "26-0001" }, "2026-2027", "FIRST", null),
        "A section with a conflicting active Faculty assignment period was accepted.");
    await Execute("DELETE FROM facultysections;");

    var assigned = await EnrollmentSectioningService.AssignAsync(connection, 1, new[] { "26-0001", "26-0001", "1", "26-0009" }, "2026-2027", "FIRST", "BSIT");
    Check(assigned.Count == 2, "Duplicate student IDs/aliases counted more than once.");
    Check((await EnrollmentSectioningService.GetUnassignedAsync(connection, "BSIT", 1, "2026-2027", "FIRST", null)).Count == 0, "Assigned students still appear in picker.");
    Check(Convert.ToInt64(await Scalar("SELECT COUNT(*) FROM student_enrollments WHERE student_user_id = 1 AND academic_section_id IS NULL")) == 2, "Assignment changed other periods.");
    Check((string?)await Scalar("SELECT section FROM studentprofiles WHERE user_id = 1") == "4-9", "Older assignment overwrote the newer profile snapshot.");
    Check((string?)await Scalar("SELECT section FROM studentprofiles WHERE user_id = 9") == "1-1", "Current snapshot did not update.");
    Check((await EnrollmentSectioningService.AssignAsync(connection, 1, new[] { "26-0009" }, "2026-2027", "FIRST", null)).Count == 1, "Retry is not idempotent.");

    var sourceEnrollmentId = Convert.ToInt64(await Scalar(
        "SELECT enrollment_id FROM student_enrollments WHERE student_user_id = 9 AND school_year = '2026-2027' AND semester = 'FIRST'"));
    await using (var sourceTransaction = await connection.BeginTransactionAsync())
    {
        var source = await EnrollmentSectioningService.GetPromotionSourceForUpdateAsync(
            connection, sourceTransaction, sourceEnrollmentId);
        Check(source is not null && source.EnrollmentId == sourceEnrollmentId &&
              source.StudentUserId == 9 && source.AcademicSectionId == 1 &&
              source.ProgramCode == "BSIT" && source.YearLevel == 1 &&
              source.SchoolYear == "2026-2027" && source.Semester == "FIRST" &&
              source.EnrollmentState == "PLANNING",
            "Promotion source lookup did not preserve exact immutable enrollment identity.");
        await sourceTransaction.RollbackAsync();
    }

    await Execute("UPDATE student_enrollments SET enrollment_state = 'FINALIZED', finalized_at = CURRENT_TIMESTAMP, finalized_by = 1 WHERE academic_section_id IN (1, 2) AND school_year = '2026-2027' AND semester = 'FIRST';");
    await Execute("UPDATE student_enrollments SET academic_section_id = 1, section = '1-1', enrollment_state = 'FINALIZED', finalized_at = CURRENT_TIMESTAMP, finalized_by = 1 WHERE student_user_id = 4 AND school_year = '2026-2027' AND semester = 'FIRST';");
    await Reject(() => EnrollmentSectioningService.AssignAsync(connection, 1, new[] { "26-0009" }, "2026-2027", "FIRST", null),
        "A finalized section remained assignable before explicit unlock.");
    await Reject(() => EnrollmentSectioningService.UnassignAsync(connection, 1, "26-0021", "2026-2027", "FIRST"),
        "A browser-only orphan bypassed the finalized section guard.");
    await using (var unlockTransaction = await connection.BeginTransactionAsync())
    {
        var unlocked = await EnrollmentSectioningService.UnlockSectionAsync(
            connection, unlockTransaction, 1, "2026-2027", "FIRST");
        Check(unlocked.MatchedCount == 3 && unlocked.UnlockedCount == 3 && !unlocked.AlreadyUnlocked,
            "Exact section unlock did not reopen only its finalized enrollment rows.");
        await unlockTransaction.CommitAsync();
    }
    await using (var repeatedUnlockTransaction = await connection.BeginTransactionAsync())
    {
        var repeated = await EnrollmentSectioningService.UnlockSectionAsync(
            connection, repeatedUnlockTransaction, 1, "2026-2027", "FIRST");
        Check(repeated.MatchedCount == 3 && repeated.UnlockedCount == 0 && repeated.AlreadyUnlocked,
            "Repeated section unlock was not idempotent.");
        await repeatedUnlockTransaction.CommitAsync();
    }
    Check((string?)await Scalar("SELECT enrollment_state FROM student_enrollments WHERE student_user_id = 5 AND school_year = '2026-2027' AND semester = 'FIRST'") == "FINALIZED",
        "Unlocking one section modified a different section's lock state.");
    Check((string?)await Scalar("SELECT status || ':' || enrollment_state FROM student_enrollments WHERE student_user_id = 4 AND school_year = '2026-2027' AND semester = 'FIRST'") == "COMPLETED:PLANNING",
        "Unlock skipped retained section enrollments or changed their enrollment status.");
    await using (var refreshedSourceTransaction = await connection.BeginTransactionAsync())
    {
        var refreshedSource = await EnrollmentSectioningService.GetPromotionSourceForUpdateAsync(
            connection, refreshedSourceTransaction, sourceEnrollmentId);
        Check(refreshedSource is not null && refreshedSource.StudentUserId == 9 &&
              refreshedSource.AcademicSectionId == 1 && refreshedSource.EnrollmentState == "PLANNING" &&
              refreshedSource.FinalizedAt is null && refreshedSource.FinalizedBy is null,
            "Unlock changed immutable source identity or left stale finalization metadata.");
        await refreshedSourceTransaction.RollbackAsync();
    }
    Check((await EnrollmentSectioningService.AssignAsync(connection, 1, new[] { "26-0009" }, "2026-2027", "FIRST", null)).Count == 1,
        "Section assignment did not become eligible after a valid unlock.");
    var enrollmentCountBeforeOrphanRemoval = Convert.ToInt64(await Scalar("SELECT COUNT(*) FROM student_enrollments"));
    var orphanRemoval = await EnrollmentSectioningService.UnassignAsync(connection, 1, "26-0021", "2026-2027", "FIRST");
    Check(orphanRemoval.AlreadyAbsent && !orphanRemoval.Unassigned,
        "Removing a browser-only orphan did not return AlreadyAbsent = true.");
    Check(Convert.ToInt64(await Scalar("SELECT COUNT(*) FROM student_enrollments")) == enrollmentCountBeforeOrphanRemoval,
        "Removing a browser-only orphan recreated or deleted enrollment history.");

    var unassignActive = await EnrollmentSectioningService.UnassignAsync(connection, 1, "26-0009", "2026-2027", "FIRST");
    Check(unassignActive.Unassigned && !unassignActive.AlreadyAbsent,
        "Unassigning an existing active student enrollment did not return Unassigned = true.");
    Check(await Scalar("SELECT academic_section_id FROM student_enrollments WHERE student_user_id = 9 AND school_year = '2026-2027' AND semester = 'FIRST'") == DBNull.Value,
        "Active student enrollment was not unassigned from section.");

    await Execute("UPDATE student_enrollments SET academic_section_id = 1, section = '1-1' WHERE student_user_id = 8 AND school_year = '2026-2027' AND semester = 'FIRST';");
    var unassignInactive = await EnrollmentSectioningService.UnassignAsync(connection, 1, "26-0008", "2026-2027", "FIRST");
    Check(unassignInactive.Unassigned && !unassignInactive.AlreadyAbsent,
        "Unassigning an inactive student with an existing enrollment failed.");
    Check(await Scalar("SELECT academic_section_id FROM student_enrollments WHERE student_user_id = 8 AND school_year = '2026-2027' AND semester = 'FIRST'") == DBNull.Value,
        "Inactive student enrollment was not unassigned from section.");

    await Execute("INSERT INTO student_enrollments (student_user_id, student_no, program_id, academic_section_id, school_year, semester, year_level, section) VALUES (NULL, '26-0021', 1, 1, '2026-2027', 'FIRST', 1, '1-1');");
    var unassignDeleted = await EnrollmentSectioningService.UnassignAsync(connection, 1, "26-0021", "2026-2027", "FIRST");
    Check(unassignDeleted.Unassigned && !unassignDeleted.AlreadyAbsent,
        "Unassigning an enrollment with a deleted account did not return Unassigned = true.");
    Check(Convert.ToInt64(await Scalar("SELECT COUNT(*) FROM student_enrollments WHERE student_no = '26-0021' AND student_user_id IS NULL AND academic_section_id IS NULL")) == 1,
        "Removing an enrollment with a deleted account did not retain its history and clear only the planning section.");

    Check(Convert.ToInt32(await Scalar("SELECT academic_section_id FROM student_enrollments WHERE student_user_id = 5 AND school_year = '2026-2027' AND semester = 'FIRST'")) == 2,
        "Removing a student from section 1 mutated an enrollment in section 2.");

    // Race two requests for the same unassigned enrollment; exactly one may win.
    await Execute("UPDATE student_enrollments SET academic_section_id = NULL, section = NULL WHERE student_user_id = 9;");
    async Task<bool> AssignConcurrent(int sectionId)
    {
        await using var other = new NpgsqlConnection(connectionString);
        await other.OpenAsync();
        await using (var searchPath = new NpgsqlCommand($"SET search_path TO {schema}", other)) await searchPath.ExecuteNonQueryAsync();
        try { await EnrollmentSectioningService.AssignAsync(other, sectionId, new[] { "26-0009" }, "2026-2027", "FIRST", null); return true; }
        catch (InvalidOperationException) { return false; }
    }
    var races = await Task.WhenAll(AssignConcurrent(1), AssignConcurrent(2));
    Check(races.Count(success => success) == 1, "Competing requests reassigned a student silently.");
    var previousSection = Convert.ToInt32(await Scalar("SELECT academic_section_id FROM student_enrollments WHERE student_user_id = 9"));
    var targetSection = previousSection == 1 ? 2 : 1;
    var expectedSections = new Dictionary<string, int> { ["26-0009"] = previousSection };
    await EnrollmentSectioningService.AssignAsync(connection, targetSection, new[] { "26-0009" }, "2026-2027", "FIRST", null, expectedSections);
    Check(Convert.ToInt32(await Scalar("SELECT academic_section_id FROM student_enrollments WHERE student_user_id = 9")) == targetSection,
        "An intentional move with the saved previous section was rejected.");
    await Reject(() => EnrollmentSectioningService.AssignAsync(connection, previousSection, new[] { "26-0009" }, "2026-2027", "FIRST", null,
        new Dictionary<string, int> { ["26-0009"] = 999 }), "Stale section move was accepted.");
    // Bulk unlock spans departments/year levels but never crosses the exact period.
    await Execute(@"
        INSERT INTO student_enrollments (student_user_id, student_no, program_id, academic_section_id,
            school_year, semester, year_level, section, status, enrollment_state, finalized_at, finalized_by)
        VALUES (1, '26-0001', 2, 3, '2028-2029', 'FIRST', 1, '1-1', 'DROPPED', 'FINALIZED', CURRENT_TIMESTAMP, 1),
               (2, '26-0002', 1, 4, '2028-2029', 'FIRST', 2, '2-1', 'ENROLLED', 'FINALIZED', CURRENT_TIMESTAMP, 1),
               (3, '26-0003', 1, 1, '2028-2029', 'FIRST', 1, '1-1', 'ENROLLED', 'PLANNING', NULL, NULL),
               (4, '26-0004', 1, 4, '2028-2029', 'SECOND', 2, '2-1', 'ENROLLED', 'FINALIZED', CURRENT_TIMESTAMP, 1);");
    var countBeforeBulk = Convert.ToInt64(await Scalar("SELECT COUNT(*) FROM student_enrollments"));
    const string preservedEnrollmentData = @"SELECT jsonb_agg(to_jsonb(e) - 'enrollment_state' - 'finalized_at' - 'finalized_by' - 'updated_at' ORDER BY enrollment_id)::text FROM student_enrollments e";
    var dataBeforeBulk = (string?)await Scalar(preservedEnrollmentData);
    await using (var rollbackBulk = await connection.BeginTransactionAsync(System.Data.IsolationLevel.Serializable))
    {
        var result = await EnrollmentSectioningService.UnlockAllSectionsAsync(connection, rollbackBulk, "2028-2029", "FIRST");
        Check(result.Count == 2 && result.Select(s => s.ProgramId).Distinct().Count() == 2 && result.Sum(s => s.UnlockedCount) == 2,
            "Bulk unlock missed departments/year levels or counted already unlocked sections.");
        await rollbackBulk.RollbackAsync();
    }
    Check(Convert.ToInt64(await Scalar("SELECT COUNT(*) FROM student_enrollments WHERE school_year = '2028-2029' AND semester = 'FIRST' AND enrollment_state = 'FINALIZED'")) == 2,
        "Bulk rollback did not preserve every lock.");
    await using (var commitBulk = await connection.BeginTransactionAsync(System.Data.IsolationLevel.Serializable))
    {
        await EnrollmentSectioningService.UnlockAllSectionsAsync(connection, commitBulk, "2028-2029", "FIRST");
        await commitBulk.CommitAsync();
    }
    Check((string?)await Scalar("SELECT status || ':' || enrollment_state FROM student_enrollments WHERE student_user_id = 1 AND school_year = '2028-2029' AND semester = 'FIRST'") == "DROPPED:PLANNING",
        "Bulk unlock restored a dropped student.");
    Check(Convert.ToInt64(await Scalar("SELECT COUNT(*) FROM student_enrollments WHERE school_year = '2028-2029' AND semester = 'SECOND' AND enrollment_state = 'FINALIZED'")) == 1,
        "Bulk unlock changed another semester.");
    Check(Convert.ToInt64(await Scalar("SELECT COUNT(*) FROM student_enrollments")) == countBeforeBulk,
        "Bulk unlock changed enrollment row count.");
    Check((string?)await Scalar(preservedEnrollmentData) == dataBeforeBulk,
        "Bulk unlock changed enrollment identity, status, assignment, curriculum, or history data.");
    Check((string?)await Scalar("SELECT enrollment_state FROM student_enrollments WHERE student_user_id = 5 AND school_year = '2026-2027' AND semester = 'FIRST'") == "FINALIZED",
        "Bulk unlock changed historical school-year locks.");
    await using (var retryBulk = await connection.BeginTransactionAsync())
    {
        Check((await EnrollmentSectioningService.UnlockAllSectionsAsync(connection, retryBulk, "2028-2029", "FIRST")).Count == 0,
            "Repeated bulk unlock was not idempotent.");
        await retryBulk.CommitAsync();
    }
    await Execute("UPDATE student_enrollments SET enrollment_state = 'FINALIZED' WHERE school_year = '2028-2029' AND semester = 'FIRST' AND academic_section_id IN (3,4);");
    async Task<int> ConcurrentBulkUnlock()
    {
        await using var other = new NpgsqlConnection(connectionString);
        await other.OpenAsync();
        await using (var path = new NpgsqlCommand($"SET search_path TO {schema}", other)) await path.ExecuteNonQueryAsync();
        await using var transaction = await other.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        try
        {
            var result = await EnrollmentSectioningService.UnlockAllSectionsAsync(other, transaction, "2028-2029", "FIRST");
            await transaction.CommitAsync();
            return result.Sum(section => section.UnlockedCount);
        }
        catch (PostgresException ex) when (ex.SqlState is "40001" or "40P01") { return 0; }
    }
    var bulkRaces = await Task.WhenAll(ConcurrentBulkUnlock(), ConcurrentBulkUnlock());
    Check(bulkRaces.Sum() == 2,
        "Concurrent bulk requests double-counted enrollment unlocks or lost committed changes.");
    Console.WriteLine("PASS: enrollment sectioning, individual unlock, cross-department bulk unlock, period isolation, rollback, retries, and concurrent assignment.");
}
finally
{
    await Execute($"DROP SCHEMA {schema} CASCADE;");
}
