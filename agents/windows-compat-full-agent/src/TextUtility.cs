namespace GCAC.WindowsCompatibilityAgent
{
    internal static class TextUtility
    {
        public static bool IsBlank(string value)
        {
            return string.IsNullOrEmpty(value) || value.Trim().Length == 0;
        }
    }
}
