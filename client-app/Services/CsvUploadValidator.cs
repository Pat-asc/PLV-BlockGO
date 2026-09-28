using System.Text;
using Microsoft.AspNetCore.Http;

namespace Client_app.Services;

public static class CsvUploadValidator
{
    public const long MaximumFileBytes = 10L * 1024 * 1024;
    public const long MaximumMultipartBodyBytes = MaximumFileBytes + (64 * 1024);

    private static readonly HashSet<string> AllowedContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "text/csv",
        "application/csv",
        "text/plain",
        "application/vnd.ms-excel",
        "application/octet-stream"
    };

    private static readonly HashSet<string> AllowedWorkbookContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/octet-stream"
    };

    public static async Task<string?> ValidateAsync(IFormFile? file, CancellationToken cancellationToken = default)
    {
        if (file is null || file.Length == 0)
            return "A non-empty CSV file is required.";
        if (!string.Equals(Path.GetExtension(file.FileName), ".csv", StringComparison.OrdinalIgnoreCase))
            return "Only CSV files are allowed.";
        if (file.Length >= MaximumFileBytes)
            return "The selected CSV file must be less than 10 MB.";

        var contentType = (file.ContentType ?? string.Empty).Split(';', 2)[0].Trim();
        if (contentType.Length > 0 && !AllowedContentTypes.Contains(contentType))
            return "Only CSV files are allowed.";

        var sampleLength = (int)Math.Min(file.Length, 16 * 1024);
        var sample = new byte[sampleLength];
        await using var stream = file.OpenReadStream();
        var bytesRead = 0;
        while (bytesRead < sampleLength)
        {
            var read = await stream.ReadAsync(sample.AsMemory(bytesRead, sampleLength - bytesRead), cancellationToken);
            if (read == 0) break;
            bytesRead += read;
        }

        if (HasNonCsvSignature(sample, bytesRead) || LooksBinary(sample, bytesRead))
            return "The selected file does not contain valid CSV text.";

        string text;
        try
        {
            text = new UTF8Encoding(false, true).GetString(sample, 0, bytesRead);
        }
        catch (DecoderFallbackException)
        {
            return "The selected file does not contain valid UTF-8 CSV text.";
        }

        var firstNonEmptyLine = text.Split(new[] { "\r\n", "\n", "\r" }, StringSplitOptions.RemoveEmptyEntries)
            .FirstOrDefault(line => !string.IsNullOrWhiteSpace(line));
        if (string.IsNullOrWhiteSpace(firstNonEmptyLine) || !firstNonEmptyLine.Contains(','))
            return "The selected file does not contain a valid CSV header row.";

        return null;
    }

    public static async Task<string?> ValidateGradeWorkbookAsync(
        IFormFile? file,
        CancellationToken cancellationToken = default)
    {
        if (file is null || file.Length == 0)
            return "A non-empty CSV or XLSX grade file is required.";

        var extension = Path.GetExtension(file.FileName);
        if (string.Equals(extension, ".csv", StringComparison.OrdinalIgnoreCase))
            return await ValidateAsync(file, cancellationToken);
        if (!string.Equals(extension, ".xlsx", StringComparison.OrdinalIgnoreCase))
            return "Unsupported file format. Please upload an XLSX or CSV grading template.";
        if (file.Length >= MaximumFileBytes)
            return "The selected grade file must be less than 10 MB.";

        var contentType = (file.ContentType ?? string.Empty).Split(';', 2)[0].Trim();
        if (contentType.Length > 0 && !AllowedWorkbookContentTypes.Contains(contentType))
            return "Unsupported file format. Please upload an XLSX or CSV grading template.";

        var signature = new byte[4];
        await using var stream = file.OpenReadStream();
        var bytesRead = await stream.ReadAsync(signature.AsMemory(0, signature.Length), cancellationToken);
        if (bytesRead != signature.Length || signature[0] != (byte)'P' || signature[1] != (byte)'K' ||
            signature[2] != 0x03 || signature[3] != 0x04)
            return "The selected file does not contain a valid XLSX workbook.";

        return null;
    }

    private static bool HasNonCsvSignature(byte[] bytes, int length) =>
        (length >= 2 && bytes[0] == (byte)'M' && bytes[1] == (byte)'Z') ||
        (length >= 4 && bytes[0] == (byte)'P' && bytes[1] == (byte)'K' && bytes[2] == 0x03 && bytes[3] == 0x04) ||
        (length >= 4 && bytes[0] == (byte)'%' && bytes[1] == (byte)'P' && bytes[2] == (byte)'D' && bytes[3] == (byte)'F') ||
        (length >= 4 && bytes[0] == 0xD0 && bytes[1] == 0xCF && bytes[2] == 0x11 && bytes[3] == 0xE0);

    private static bool LooksBinary(byte[] bytes, int length)
    {
        for (var index = 0; index < length; index++)
        {
            var value = bytes[index];
            if (value == 0) return true;
            if (value < 0x09 || (value > 0x0D && value < 0x20)) return true;
        }
        return false;
    }
}
