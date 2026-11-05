using System.Text.RegularExpressions;

namespace Client_app.Services;

public static partial class PasswordPolicy
{
    public const string ErrorMessage = "Password must be 8-128 characters and include an uppercase letter, lowercase letter, number, and special character.";

    public static bool IsValid(string? password)
    {
        if (string.IsNullOrEmpty(password) || password.Length < 8 || password.Length > 128)
        {
            return false;
        }

        return Uppercase().IsMatch(password)
            && Lowercase().IsMatch(password)
            && Number().IsMatch(password)
            && Special().IsMatch(password)
            && !ObviousPassword().IsMatch(password);
    }

    public static void EnsureValid(string? password)
    {
        if (!IsValid(password))
        {
            throw new ArgumentException(ErrorMessage);
        }
    }

    [GeneratedRegex("[A-Z]")]
    private static partial Regex Uppercase();

    [GeneratedRegex("[a-z]")]
    private static partial Regex Lowercase();

    [GeneratedRegex("[0-9]")]
    private static partial Regex Number();

    [GeneratedRegex("[^A-Za-z0-9\\s]")]
    private static partial Regex Special();

    [GeneratedRegex("^(?:password|password123|admin|admin123|qwerty|letmein|changeme)[!@#$%^&*]?$", RegexOptions.IgnoreCase)]
    private static partial Regex ObviousPassword();
}
