using System;

namespace GCAC.WindowsCompatibilityAgent
{
    internal static class TransportProtocol
    {
        public static bool IsHttps(string endpoint)
        {
            Uri parsed;
            return Uri.TryCreate(endpoint, UriKind.Absolute, out parsed)
                && string.Equals(parsed.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase);
        }
    }
}
