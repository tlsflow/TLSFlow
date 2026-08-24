using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;

namespace GCAC.WindowsCompatibilityAgent
{
    /// <summary>
    /// 采集 Windows 非 IIS 运行时的只读事实。
    /// 产品差异只存在于配置格式解析，不进入原子执行 Registry，也不执行任何写入或服务控制。
    /// </summary>
    internal sealed class WindowsRuntimeDiscovery
    {
        private readonly string[] roots;

        public WindowsRuntimeDiscovery(AgentConfig config)
            : this(ParseRoots(Environment.GetEnvironmentVariable("GCAC_DISCOVERY_ROOTS")))
        {
        }

        internal WindowsRuntimeDiscovery(string[] candidateRoots)
        {
            roots = candidateRoots == null || candidateRoots.Length == 0
                ? new string[] { @"C:\GCAC-Lab-2012R2", @"C:\GCAC-Lab" }
                : candidateRoots;
        }

        public Dictionary<string, object> Collect(string requestId)
        {
            List<Dictionary<string, object>> services = new List<Dictionary<string, object>>();
            List<Dictionary<string, object>> serviceAssets = new List<Dictionary<string, object>>();
            List<Dictionary<string, object>> siteAssets = new List<Dictionary<string, object>>();
            List<Dictionary<string, object>> bindings = new List<Dictionary<string, object>>();
            List<Dictionary<string, object>> warnings = new List<Dictionary<string, object>>();
            List<Dictionary<string, object>> evidence = new List<Dictionary<string, object>>();
            List<RuntimeServiceFact> serviceFacts = ReadServices(warnings);
            List<RuntimeProcessFact> processFacts = ReadProcesses(warnings);
            HashSet<string> discoveredProducts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            List<string> candidateRoots = BuildCandidateRoots(serviceFacts, processFacts);

            foreach (string root in candidateRoots)
            {
                if (TextUtility.IsBlank(root) || !Directory.Exists(root)) continue;
                DiscoverNginx(root, serviceFacts, processFacts, discoveredProducts, services, serviceAssets, siteAssets, bindings, warnings, evidence);
                DiscoverApache(root, serviceFacts, processFacts, discoveredProducts, services, serviceAssets, siteAssets, bindings, warnings, evidence);
                DiscoverTomcat(root, serviceFacts, processFacts, discoveredProducts, services, serviceAssets, siteAssets, bindings, warnings, evidence);
            }

            Dictionary<string, object> host = new Dictionary<string, object>();
            host["hostname"] = Environment.MachineName;
            host["osType"] = "WINDOWS";
            host["discoverySource"] = "AGENT";
            host["managementMode"] = "AGENT";
            host["status"] = "ACTIVE";

            Dictionary<string, object> result = new Dictionary<string, object>();
            result["hosts"] = new List<Dictionary<string, object>> { host };
            result["services"] = services;
            result["serviceAssets"] = serviceAssets;
            result["siteAssets"] = siteAssets;
            result["bindings"] = bindings;
            result["warnings"] = UniqueWarnings(warnings);
            result["evidence"] = evidence;
            result["collectedAt"] = DateTime.UtcNow.ToString("o");
            result["source"] = "agent_direct";
            result["platform"] = "windows";
            if (!TextUtility.IsBlank(requestId)) result["requestId"] = requestId;
            return result;
        }

        private List<string> BuildCandidateRoots(List<RuntimeServiceFact> serviceFacts, List<RuntimeProcessFact> processFacts)
        {
            List<string> result = new List<string>();
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string root in roots) AddCandidateRoot(result, seen, root);
            foreach (RuntimeProcessFact process in processFacts)
            {
                if (!Matches(process.Name, "nginx", "httpd", "apache", "java", "tomcat", "prunsrv")) continue;
                AddCandidateRoot(result, seen, InstallationPath(process.ExecutablePath));
            }
            foreach (RuntimeServiceFact service in serviceFacts)
            {
                if (!Matches(service.Name, "nginx", "httpd", "apache", "tomcat", "prunsrv")) continue;
                AddCandidateRoot(result, seen, InstallationPath(ExtractExecutablePath(service.PathName)));
            }
            return result;
        }

        private static void AddCandidateRoot(List<string> result, HashSet<string> seen, string value)
        {
            if (TextUtility.IsBlank(value)) return;
            try
            {
                string path = Path.GetFullPath(value);
                if (seen.Add(path)) result.Add(path);
            }
            catch { }
        }

        private void DiscoverNginx(
            string root,
            List<RuntimeServiceFact> serviceFacts,
            List<RuntimeProcessFact> processFacts,
            HashSet<string> discoveredProducts,
            List<Dictionary<string, object>> services,
            List<Dictionary<string, object>> serviceAssets,
            List<Dictionary<string, object>> siteAssets,
            List<Dictionary<string, object>> bindings,
            List<Dictionary<string, object>> warnings,
            List<Dictionary<string, object>> evidence)
        {
            string binary = FindFile(root, "nginx.exe");
            if (TextUtility.IsBlank(binary) || !discoveredProducts.Add("NGINX:" + binary.ToLowerInvariant())) return;
            string install = InstallationPath(binary);
            string config = FindConfig(install, "nginx-gcac.conf", "nginx.conf");
            RuntimeServiceFact service = FindService(serviceFacts, "nginx");
            RuntimeProcessFact process = FindProcess(processFacts, "nginx.exe", binary);
            Dictionary<string, object> detail = ProductDetail("NGINX", binary, install, config, service, process);
            List<Dictionary<string, object>> productWarnings = new List<Dictionary<string, object>>();
            List<Dictionary<string, object>> parsedSites = ParseNginx(config, productWarnings);
            detail["sites"] = parsedSites;
            detail["warnings"] = productWarnings;
            detail["configFingerprint"] = ConfigFingerprint(config, productWarnings);
            services.Add(detail);
            warnings.AddRange(productWarnings);
            evidence.Add(Evidence("NGINX", binary, config, "PROCESS_OR_SCANNED_ROOT"));
            AppendStandardRecords("NGINX", "nginx", install, detail, parsedSites, serviceAssets, siteAssets, bindings);
        }

        private void DiscoverApache(
            string root,
            List<RuntimeServiceFact> serviceFacts,
            List<RuntimeProcessFact> processFacts,
            HashSet<string> discoveredProducts,
            List<Dictionary<string, object>> services,
            List<Dictionary<string, object>> serviceAssets,
            List<Dictionary<string, object>> siteAssets,
            List<Dictionary<string, object>> bindings,
            List<Dictionary<string, object>> warnings,
            List<Dictionary<string, object>> evidence)
        {
            string binary = FindFile(root, "httpd.exe");
            if (TextUtility.IsBlank(binary) || !discoveredProducts.Add("APACHE:" + binary.ToLowerInvariant())) return;
            string install = InstallationPath(binary);
            string config = FindConfig(install, "httpd-gcac.conf", "httpd.conf");
            RuntimeServiceFact service = FindService(serviceFacts, "apache", "httpd");
            RuntimeProcessFact process = FindProcess(processFacts, "httpd.exe", binary);
            Dictionary<string, object> detail = ProductDetail("APACHE", binary, install, config, service, process);
            List<Dictionary<string, object>> productWarnings = new List<Dictionary<string, object>>();
            List<Dictionary<string, object>> parsedSites = ParseApache(config, productWarnings);
            detail["sites"] = parsedSites;
            detail["warnings"] = productWarnings;
            detail["configFingerprint"] = ConfigFingerprint(config, productWarnings);
            services.Add(detail);
            warnings.AddRange(productWarnings);
            evidence.Add(Evidence("APACHE", binary, config, "PROCESS_OR_SCM"));
            AppendStandardRecords("APACHE", TextUtility.IsBlank(service == null ? null : service.Name) ? "apache" : service.Name, install, detail, parsedSites, serviceAssets, siteAssets, bindings);
        }

        private void DiscoverTomcat(
            string root,
            List<RuntimeServiceFact> serviceFacts,
            List<RuntimeProcessFact> processFacts,
            HashSet<string> discoveredProducts,
            List<Dictionary<string, object>> services,
            List<Dictionary<string, object>> serviceAssets,
            List<Dictionary<string, object>> siteAssets,
            List<Dictionary<string, object>> bindings,
            List<Dictionary<string, object>> warnings,
            List<Dictionary<string, object>> evidence)
        {
            foreach (string config in FindFiles(root, "server.xml"))
            {
                string install = Path.GetDirectoryName(Path.GetDirectoryName(config));
                if (TextUtility.IsBlank(install) || !discoveredProducts.Add("TOMCAT:" + install.ToLowerInvariant())) continue;
                RuntimeServiceFact service = FindService(serviceFacts, "tomcat", "prunsrv");
                RuntimeProcessFact process = FindProcess(processFacts, "java.exe", null);
                string binary = FindFile(install, "tomcat*.exe");
                Dictionary<string, object> detail = ProductDetail("TOMCAT", binary, install, config, service, process);
                List<Dictionary<string, object>> productWarnings = new List<Dictionary<string, object>>();
                List<Dictionary<string, object>> parsedSites = ParseTomcat(config, install, productWarnings);
                detail["connectors"] = parsedSites;
                detail["warnings"] = productWarnings;
                detail["configFingerprint"] = ConfigFingerprint(config, productWarnings);
                services.Add(detail);
                warnings.AddRange(productWarnings);
                evidence.Add(Evidence("TOMCAT", binary, config, "CONFIGURATION_AND_SCM"));
                AppendStandardRecords("TOMCAT", TextUtility.IsBlank(service == null ? null : service.Name) ? "tomcat" : service.Name, install, detail, parsedSites, serviceAssets, siteAssets, bindings);
            }
        }

        private static Dictionary<string, object> ProductDetail(string product, string binary, string install, string config, RuntimeServiceFact service, RuntimeProcessFact process)
        {
            Dictionary<string, object> detail = new Dictionary<string, object>();
            detail["framework"] = product;
            detail["product"] = product;
            detail["installed"] = true;
            detail["running"] = process != null || (service != null && string.Equals(service.State, "Running", StringComparison.OrdinalIgnoreCase));
            if (!TextUtility.IsBlank(binary)) detail["executablePath"] = Path.GetFullPath(binary);
            if (!TextUtility.IsBlank(install)) detail["installationPath"] = Path.GetFullPath(install);
            if (!TextUtility.IsBlank(config)) detail["configurationPath"] = Path.GetFullPath(config);
            if (service != null)
            {
                detail["serviceName"] = service.Name;
                detail["serviceStatus"] = service.State;
            }
            if (product == "TOMCAT")
            {
                string tomcatVersion = ReadTomcatVersion(install);
                if (!TextUtility.IsBlank(tomcatVersion)) detail["version"] = tomcatVersion;
                else if (process != null && !TextUtility.IsBlank(process.Version)) detail["version"] = process.Version;
            }
            else if (process != null && !TextUtility.IsBlank(process.Version)) detail["version"] = process.Version;
            else if (!TextUtility.IsBlank(binary)) detail["version"] = ReadFileVersion(binary);
            if (!detail.ContainsKey("version") || TextUtility.IsBlank(Value(detail, "version")))
            {
                string pathVersion = ReadVersionFromPath(install);
                if (!TextUtility.IsBlank(pathVersion)) detail["version"] = pathVersion;
            }
            detail["evidence"] = new string[] { "windows.scm", "windows.process", "controlled-root", "configuration-read" };
            return detail;
        }

        private static List<Dictionary<string, object>> ParseNginx(string config, List<Dictionary<string, object>> warnings)
        {
            List<Dictionary<string, object>> sites = new List<Dictionary<string, object>>();
            string text = ReadText(config, "NGINX", warnings);
            if (text == null) return sites;
            string baseDirectory = Path.GetDirectoryName(config);
            foreach (string block in ExtractBlocks(text, "server"))
            {
                Dictionary<string, string> directives = ParseDirectives(block);
                string[] names = SplitWords(GetValue(directives, "server_name"));
                string cert = ResolvePath(GetValue(directives, "ssl_certificate"), baseDirectory);
                string key = ResolvePath(GetValue(directives, "ssl_certificate_key"), baseDirectory);
                List<Dictionary<string, object>> listeners = new List<Dictionary<string, object>>();
                foreach (string listen in GetValues(directives, "listen"))
                {
                    Dictionary<string, object> listener = ParseEndpoint(listen, names, cert, key, null, null);
                    if (listener != null) listeners.Add(listener);
                }
                if (listeners.Count == 0 && !TextUtility.IsBlank(cert))
                    listeners.Add(ParseEndpoint("443 ssl", names, cert, key, null, null));
                if (listeners.Count > 0) sites.Add(BuildSite("NGINX", names, listeners, config, baseDirectory, warnings));
            }
            return sites;
        }

        private static List<Dictionary<string, object>> ParseApache(string config, List<Dictionary<string, object>> warnings)
        {
            List<Dictionary<string, object>> sites = new List<Dictionary<string, object>>();
            string text = ReadText(config, "APACHE", warnings);
            if (text == null) return sites;
            string baseDirectory = Path.GetDirectoryName(config);
            foreach (string block in ExtractTagBlocks(text, "VirtualHost"))
            {
                Dictionary<string, string> directives = ParseDirectives(block);
                string[] names = NormalizeHostNames(SplitWords(GetValue(directives, "ServerName") + " " + GetValue(directives, "ServerAlias")));
                string cert = ResolvePath(GetValue(directives, "SSLCertificateFile"), baseDirectory);
                string key = ResolvePath(GetValue(directives, "SSLCertificateKeyFile"), baseDirectory);
                string chain = ResolvePath(GetValue(directives, "SSLCertificateChainFile"), baseDirectory);
                List<Dictionary<string, object>> listeners = new List<Dictionary<string, object>>();
                foreach (string endpoint in GetValues(directives, "VirtualHost"))
                {
                    Dictionary<string, object> listener = ParseEndpoint(endpoint, names, cert, key, chain, null);
                    if (listener != null) listeners.Add(listener);
                }
                if (listeners.Count > 0) sites.Add(BuildSite("APACHE", names, listeners, config, baseDirectory, warnings));
            }
            if (sites.Count == 0)
            {
                Dictionary<string, string> directives = ParseDirectives(text);
                string[] names = NormalizeHostNames(SplitWords(GetValue(directives, "ServerName")));
                string cert = ResolvePath(GetValue(directives, "SSLCertificateFile"), baseDirectory);
                string key = ResolvePath(GetValue(directives, "SSLCertificateKeyFile"), baseDirectory);
                string chain = ResolvePath(GetValue(directives, "SSLCertificateChainFile"), baseDirectory);
                List<Dictionary<string, object>> listeners = new List<Dictionary<string, object>>();
                foreach (string endpoint in GetValues(directives, "Listen"))
                {
                    Dictionary<string, object> listener = ParseEndpoint(endpoint, names, cert, key, chain, null);
                    if (listener != null) listeners.Add(listener);
                }
                if (listeners.Count > 0) sites.Add(BuildSite("APACHE", names, listeners, config, baseDirectory, warnings));
            }
            return sites;
        }

        private static List<Dictionary<string, object>> ParseTomcat(string config, string install, List<Dictionary<string, object>> warnings)
        {
            List<Dictionary<string, object>> sites = new List<Dictionary<string, object>>();
            XmlDocument document = new XmlDocument();
            try { document.Load(config); }
            catch (Exception error)
            {
                warnings.Add(Warning("CONFIG_PARSE_FAILED", "Tomcat server.xml 解析失败：" + error.Message, config));
                return sites;
            }
            XmlNodeList connectors = document.GetElementsByTagName("Connector");
            foreach (XmlElement connector in connectors)
            {
                XmlElement certificate = null;
                foreach (XmlNode child in connector.GetElementsByTagName("Certificate"))
                {
                    certificate = child as XmlElement;
                    if (certificate != null) break;
                }
                string sslEnabled = connector.GetAttribute("SSLEnabled");
                string scheme = connector.GetAttribute("scheme");
                if (!string.Equals(sslEnabled, "true", StringComparison.OrdinalIgnoreCase) && !string.Equals(scheme, "https", StringComparison.OrdinalIgnoreCase)) continue;
                string cert = ResolvePath(FirstAttribute(connector, certificate, "certificateFile"), install);
                string key = ResolvePath(FirstAttribute(connector, certificate, "certificateKeyFile"), install);
                string chain = ResolvePath(FirstAttribute(connector, certificate, "certificateChainFile"), install);
                string keystore = ResolvePath(FirstAttribute(connector, certificate, "certificateKeystoreFile", "keystoreFile"), install);
                string keystoreType = FirstAttribute(connector, certificate, "certificateKeystoreType", "keystoreType");
                string alias = FirstAttribute(connector, certificate, "certificateKeyAlias", "keyAlias");
                string[] names = NormalizeHostNames(new string[] { FirstAttribute(connector, "hostName", "address"), FindTomcatHost(document) });
                string address = FirstAttribute(connector, "address");
                string port = FirstAttribute(connector, "port");
                Dictionary<string, object> listener = ParseEndpoint(TextUtility.IsBlank(address) ? port : address + ":" + port, names, cert, key, chain, keystore);
                if (listener == null) continue;
                if (!TextUtility.IsBlank(keystore)) listener["keystoreType"] = TextUtility.IsBlank(keystoreType) ? "PKCS12_OR_JKS" : keystoreType;
                if (!TextUtility.IsBlank(alias)) listener["keyAlias"] = alias;
                sites.Add(BuildSite("TOMCAT", names, new List<Dictionary<string, object>> { listener }, config, install, warnings));
            }
            return sites;
        }

        private static Dictionary<string, object> BuildSite(string product, string[] names, List<Dictionary<string, object>> listeners, string config, string sitePath, List<Dictionary<string, object>> warnings)
        {
            string name = FirstNonBlank(names);
            if (TextUtility.IsBlank(name)) name = product.ToLowerInvariant() + "-site";
            Dictionary<string, object> site = new Dictionary<string, object>();
            site["framework"] = product;
            site["name"] = name;
            site["serverNames"] = names;
            site["sitePath"] = sitePath;
            site["configurationPath"] = config;
            site["listen"] = listeners;
            site["configFingerprint"] = FileFingerprint(config);
            site["evidence"] = new string[] { "configuration-read" };
            foreach (Dictionary<string, object> listener in listeners)
            {
                string certificatePath = Value(listener, "certificatePath");
                if (!TextUtility.IsBlank(certificatePath) && File.Exists(certificatePath))
                {
                    Dictionary<string, object> certificate = ReadCertificateSummary(certificatePath);
                    if (certificate != null) listener["certificate"] = certificate;
                }
                else if (!TextUtility.IsBlank(certificatePath))
                    warnings.Add(Warning("CERTIFICATE_NOT_FOUND", "证书文件不存在", certificatePath));
                string keystorePath = Value(listener, "keystorePath");
                if (!TextUtility.IsBlank(keystorePath) && !File.Exists(keystorePath))
                    warnings.Add(Warning("KEYSTORE_NOT_FOUND", "KeyStore 文件不存在", keystorePath));
            }
            return site;
        }

        private static void AppendStandardRecords(
            string product,
            string serviceName,
            string install,
            Dictionary<string, object> detail,
            List<Dictionary<string, object>> sites,
            List<Dictionary<string, object>> serviceAssets,
            List<Dictionary<string, object>> siteAssets,
            List<Dictionary<string, object>> bindings)
        {
            Dictionary<string, object> serviceAsset = new Dictionary<string, object>();
            serviceAsset["framework"] = product;
            serviceAsset["product"] = product;
            serviceAsset["serviceName"] = serviceName;
            serviceAsset["executablePath"] = Value(detail, "executablePath");
            serviceAsset["installationPath"] = install;
            serviceAsset["configurationPath"] = Value(detail, "configurationPath");
            serviceAsset["version"] = Value(detail, "version");
            serviceAsset["status"] = Value(detail, "serviceStatus");
            serviceAsset["evidence"] = detail["evidence"];
            serviceAssets.Add(serviceAsset);
            foreach (Dictionary<string, object> site in sites)
            {
                string siteName = Value(site, "name");
                string siteKey = AtomicValue.Sha256Hex(product + "|" + Value(detail, "configurationPath") + "|" + siteName);
                Dictionary<string, object> siteAsset = new Dictionary<string, object>();
                siteAsset["framework"] = product;
                siteAsset["product"] = product;
                siteAsset["siteKey"] = siteKey;
                siteAsset["siteName"] = siteName;
                siteAsset["serviceName"] = serviceName;
                siteAsset["configurationPath"] = Value(site, "configurationPath");
                siteAsset["listeners"] = site["listen"];
                siteAsset["evidence"] = site["evidence"];
                siteAssets.Add(siteAsset);
                foreach (Dictionary<string, object> listener in (List<Dictionary<string, object>>)site["listen"])
                {
                    Dictionary<string, object> binding = new Dictionary<string, object>();
                    binding["framework"] = product;
                    binding["product"] = product;
                    binding["siteKey"] = siteKey;
                    binding["serviceName"] = serviceName;
                    binding["address"] = Value(listener, "address");
                    binding["host"] = Value(listener, "hostHeader");
                    binding["port"] = listener["port"];
                    binding["protocol"] = Value(listener, "protocol");
                    binding["certificateBinding"] = new Dictionary<string, object>
                    {
                        { "certificatePath", Value(listener, "certificatePath") },
                        { "certificateKeyPath", Value(listener, "certificateKeyPath") },
                        { "certificateChainPath", Value(listener, "certificateChainPath") },
                        { "keystorePath", Value(listener, "keystorePath") },
                        { "keystoreType", Value(listener, "keystoreType") },
                        { "observedFingerprintSha256", CertificateFingerprint(listener) },
                        { "verifyMethod", "TLS_CONNECT" }
                    };
                    binding["evidence"] = new string[] { "configuration-read", "public-certificate-only" };
                    bindings.Add(binding);
                }
            }
        }

        private static Dictionary<string, object> ParseEndpoint(string value, string[] names, string cert, string key, string chain, string keystore)
        {
            if (TextUtility.IsBlank(value)) return null;
            string token = value.Trim().Trim('"');
            string[] parts = token.Split(new char[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) return null;
            string endpoint = parts[0];
            string address = "*";
            int port;
            if (endpoint.StartsWith("[", StringComparison.Ordinal) && endpoint.IndexOf("]:") > 0)
            {
                int close = endpoint.IndexOf("]:");
                address = endpoint.Substring(1, close - 1);
                if (!int.TryParse(endpoint.Substring(close + 2), out port)) return null;
            }
            else if (endpoint.IndexOf(':') > 0)
            {
                int colon = endpoint.LastIndexOf(':');
                address = endpoint.Substring(0, colon);
                if (!int.TryParse(endpoint.Substring(colon + 1), out port)) return null;
            }
            else if (!int.TryParse(endpoint, out port)) return null;
            Dictionary<string, object> listener = new Dictionary<string, object>();
            listener["address"] = TextUtility.IsBlank(address) ? "*" : address;
            listener["port"] = port;
            listener["protocol"] = "HTTPS";
            listener["hostHeader"] = FirstNonBlank(names);
            if (!TextUtility.IsBlank(cert)) listener["certificatePath"] = cert;
            if (!TextUtility.IsBlank(key)) listener["certificateKeyPath"] = key;
            if (!TextUtility.IsBlank(chain)) listener["certificateChainPath"] = chain;
            if (!TextUtility.IsBlank(keystore)) listener["keystorePath"] = keystore;
            return listener;
        }

        private static Dictionary<string, string> ParseDirectives(string text)
        {
            Dictionary<string, string> result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            MatchCollection matches = Regex.Matches(text ?? string.Empty, @"(?im)(?:^|[;{}])\s*([A-Za-z][A-Za-z0-9_]*)\s+([^;#{}]+);");
            foreach (Match match in matches)
                AddDirective(result, match.Groups[1].Value, match.Groups[2].Value.Trim());
            foreach (string line in (text ?? string.Empty).Split(new string[] { "\r\n", "\n" }, StringSplitOptions.None))
            {
                string value = line.Trim();
                if (value.Length == 0 || value.StartsWith("#", StringComparison.Ordinal) || value.StartsWith("<", StringComparison.Ordinal) || value.Contains("{") || value.Contains("}")) continue;
                if (value.EndsWith(";", StringComparison.Ordinal)) value = value.Substring(0, value.Length - 1).Trim();
                Match lineMatch = Regex.Match(value, @"^([A-Za-z][A-Za-z0-9_]*)\s+(.+)$");
                if (lineMatch.Success) AddDirective(result, lineMatch.Groups[1].Value, lineMatch.Groups[2].Value.Trim());
            }
            return result;
        }

        private static void AddDirective(Dictionary<string, string> values, string key, string value)
        {
            string existing;
            if (values.TryGetValue(key, out existing))
            {
                if (existing.IndexOf(value, StringComparison.OrdinalIgnoreCase) < 0) values[key] = existing + " " + value;
            }
            else values[key] = value;
        }

        private static List<string> ExtractBlocks(string text, string token)
        {
            List<string> result = new List<string>();
            Regex regex = new Regex(@"(?im)\b" + token + @"\s*\{");
            Match match = regex.Match(text ?? string.Empty);
            while (match.Success)
            {
                int open = text.IndexOf('{', match.Index);
                int depth = 0;
                int end = -1;
                for (int index = open; index < text.Length; index++)
                {
                    if (text[index] == '{') depth++;
                    else if (text[index] == '}')
                    {
                        depth--;
                        if (depth == 0) { end = index; break; }
                    }
                }
                if (end < 0) break;
                result.Add(text.Substring(open + 1, end - open - 1));
                match = regex.Match(text, end + 1);
            }
            return result;
        }

        private static List<string> ExtractTagBlocks(string text, string tag)
        {
            List<string> result = new List<string>();
            Regex start = new Regex(@"(?is)<" + tag + @"\b[^>]*>");
            Regex end = new Regex(@"(?is)</" + tag + @"\s*>");
            Match match = start.Match(text ?? string.Empty);
            while (match.Success)
            {
                Match closing = end.Match(text, match.Index + match.Length);
                if (!closing.Success) break;
                result.Add(text.Substring(match.Index + match.Length, closing.Index - match.Index - match.Length));
                Dictionary<string, string> directives = ParseDirectives(match.Value + "\n" + result[result.Count - 1]);
                string endpoint = match.Value.Substring(match.Value.IndexOf('>') + 1);
                result[result.Count - 1] = "VirtualHost " + match.Value.Substring(0, match.Value.Length - 1).Substring(match.Value.IndexOf(' ') + 1).Trim() + ";\n" + result[result.Count - 1];
                match = start.Match(text, closing.Index + closing.Length);
            }
            return result;
        }

        private static string ReadText(string path, string product, List<Dictionary<string, object>> warnings)
        {
            if (TextUtility.IsBlank(path))
            {
                warnings.Add(Warning("CONFIG_NOT_FOUND", product + " 配置文件未找到", null));
                return null;
            }
            try { return File.ReadAllText(path); }
            catch (Exception error)
            {
                warnings.Add(Warning("CONFIG_UNREADABLE", product + " 配置文件不可读：" + error.Message, path));
                return null;
            }
        }

        private static string FindFile(string root, string pattern)
        {
            foreach (string path in FindFiles(root, pattern)) return path;
            return null;
        }

        private static List<string> FindFiles(string root, string pattern)
        {
            List<string> result = new List<string>();
            try
            {
                foreach (string path in Directory.GetFiles(root, pattern, SearchOption.AllDirectories))
                    if (!path.Contains(@"\data\atomic-plans")) result.Add(Path.GetFullPath(path));
            }
            catch { }
            return result;
        }

        private static string FindConfig(string install, params string[] names)
        {
            if (TextUtility.IsBlank(install)) return null;
            string conf = Path.Combine(install, "conf");
            foreach (string name in names)
            {
                string direct = Path.Combine(conf, name);
                if (File.Exists(direct)) return Path.GetFullPath(direct);
            }
            foreach (string name in names)
            {
                string found = FindFile(install, name);
                if (!TextUtility.IsBlank(found)) return found;
            }
            return null;
        }

        private static string InstallationPath(string binary)
        {
            string directory = Path.GetDirectoryName(binary);
            if (string.Equals(Path.GetFileName(directory), "bin", StringComparison.OrdinalIgnoreCase))
                return Path.GetDirectoryName(directory);
            return directory;
        }

        private static Dictionary<string, object> Evidence(string product, string binary, string config, string source)
        {
            return new Dictionary<string, object>
            {
                { "framework", product },
                { "source", source },
                { "executablePath", binary },
                { "configurationPath", config },
                { "readOnly", true }
            };
        }

        private static Dictionary<string, object> Warning(string code, string message, string path)
        {
            Dictionary<string, object> warning = new Dictionary<string, object>();
            warning["code"] = code;
            warning["message"] = message;
            if (!TextUtility.IsBlank(path)) warning["path"] = path;
            return warning;
        }

        private static List<Dictionary<string, object>> UniqueWarnings(List<Dictionary<string, object>> values)
        {
            List<Dictionary<string, object>> result = new List<Dictionary<string, object>>();
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (Dictionary<string, object> value in values)
            {
                string key = Value(value, "code") + "|" + Value(value, "path") + "|" + Value(value, "message");
                if (seen.Add(key)) result.Add(value);
            }
            return result;
        }

        private static List<RuntimeServiceFact> ReadServices(List<Dictionary<string, object>> warnings)
        {
            List<RuntimeServiceFact> result = new List<RuntimeServiceFact>();
            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("SELECT Name, DisplayName, State, PathName FROM Win32_Service"))
                    foreach (ManagementObject item in searcher.Get())
                        result.Add(new RuntimeServiceFact
                        {
                            Name = Convert.ToString(item["Name"]),
                            DisplayName = Convert.ToString(item["DisplayName"]),
                            State = Convert.ToString(item["State"]),
                            PathName = Convert.ToString(item["PathName"])
                        });
            }
            catch (Exception error) { warnings.Add(Warning("SCM_READ_FAILED", "Windows 服务事实读取失败：" + error.Message, null)); }
            return result;
        }

        private static List<RuntimeProcessFact> ReadProcesses(List<Dictionary<string, object>> warnings)
        {
            List<RuntimeProcessFact> result = new List<RuntimeProcessFact>();
            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("SELECT Name, ExecutablePath, CommandLine FROM Win32_Process"))
                    foreach (ManagementObject item in searcher.Get())
                        result.Add(new RuntimeProcessFact
                        {
                            Name = Convert.ToString(item["Name"]),
                            ExecutablePath = Convert.ToString(item["ExecutablePath"]),
                            CommandLine = Convert.ToString(item["CommandLine"]),
                            Version = ReadFileVersion(Convert.ToString(item["ExecutablePath"]))
                        });
            }
            catch (Exception error) { warnings.Add(Warning("PROCESS_READ_FAILED", "Windows 进程事实读取失败：" + error.Message, null)); }
            return result;
        }

        private static RuntimeServiceFact FindService(List<RuntimeServiceFact> values, params string[] names)
        {
            foreach (RuntimeServiceFact value in values)
                if (Matches(value.Name, names) || Matches(value.DisplayName, names)) return value;
            foreach (RuntimeServiceFact value in values)
                if (Matches(value.PathName, names)) return value;
            return null;
        }

        private static RuntimeProcessFact FindProcess(List<RuntimeProcessFact> values, string name, string executablePath)
        {
            foreach (RuntimeProcessFact value in values)
                if (string.Equals(value.Name, name, StringComparison.OrdinalIgnoreCase) ||
                    (!TextUtility.IsBlank(executablePath) && string.Equals(value.ExecutablePath, executablePath, StringComparison.OrdinalIgnoreCase)))
                    return value;
            return null;
        }

        private static bool Matches(string value, params string[] names)
        {
            string lower = (value ?? string.Empty).ToLowerInvariant();
            foreach (string name in names ?? new string[0])
                if (!TextUtility.IsBlank(name) && lower.Contains(name.ToLowerInvariant())) return true;
            return false;
        }

        private static string ExtractExecutablePath(string pathName)
        {
            if (TextUtility.IsBlank(pathName)) return string.Empty;
            string value = pathName.Trim();
            if (value.StartsWith("\"", StringComparison.Ordinal))
            {
                int endQuote = value.IndexOf('"', 1);
                return endQuote > 1 ? value.Substring(1, endQuote - 1) : value.Trim('"');
            }
            int space = value.IndexOf(' ');
            return space > 0 ? value.Substring(0, space) : value;
        }

        private static string ReadFileVersion(string path)
        {
            try { return FileVersionInfo.GetVersionInfo(path).FileVersion ?? string.Empty; }
            catch { return string.Empty; }
        }

        private static string ReadTomcatVersion(string install)
        {
            string notes = Path.Combine(install ?? string.Empty, "RELEASE-NOTES");
            if (!File.Exists(notes)) return ReadVersionFromPath(install);
            try
            {
                string text = File.ReadAllText(notes);
                Match match = Regex.Match(text, @"(?i)\b(?:Apache Tomcat|Tomcat)\s+([0-9]+\.[0-9]+\.[0-9]+)");
                return match.Success ? match.Groups[1].Value : ReadVersionFromPath(install);
            }
            catch { return ReadVersionFromPath(install); }
        }

        private static string ReadVersionFromPath(string path)
        {
            Match match = Regex.Match(path ?? string.Empty, @"(?i)(?:nginx|apache-tomcat|tomcat)[-_]?v?([0-9]+\.[0-9]+(?:\.[0-9]+)?)");
            return match.Success ? match.Groups[1].Value : string.Empty;
        }

        private static string ConfigFingerprint(string path, List<Dictionary<string, object>> warnings)
        {
            string result = FileFingerprint(path);
            if (TextUtility.IsBlank(result) && !TextUtility.IsBlank(path)) warnings.Add(Warning("CONFIG_FINGERPRINT_UNAVAILABLE", "配置指纹无法读取", path));
            return result;
        }

        private static string FileFingerprint(string path)
        {
            if (TextUtility.IsBlank(path) || !File.Exists(path)) return string.Empty;
            try { return AtomicValue.Sha256Hex(File.ReadAllBytes(path)); }
            catch { return string.Empty; }
        }

        private static Dictionary<string, object> ReadCertificateSummary(string path)
        {
            try
            {
                byte[] raw = File.ReadAllBytes(path);
                string text = Encoding.ASCII.GetString(raw);
                Match match = Regex.Match(text, "-----BEGIN CERTIFICATE-----(.*?)-----END CERTIFICATE-----", RegexOptions.Singleline);
                if (match.Success) raw = Convert.FromBase64String(Regex.Replace(match.Groups[1].Value, @"\s+", string.Empty));
                X509Certificate2 certificate = new X509Certificate2(raw);
                Dictionary<string, object> summary = new Dictionary<string, object>();
                summary["fingerprintSha256"] = AtomicValue.Sha256Hex(certificate.RawData);
                summary["subject"] = certificate.Subject;
                summary["issuer"] = certificate.Issuer;
                summary["notBefore"] = certificate.NotBefore.ToUniversalTime().ToString("o");
                summary["notAfter"] = certificate.NotAfter.ToUniversalTime().ToString("o");
                certificate.Reset();
                return summary;
            }
            catch { return null; }
        }

        private static string CertificateFingerprint(Dictionary<string, object> listener)
        {
            object value;
            if (listener.TryGetValue("certificate", out value) && value is Dictionary<string, object>)
                return Value((Dictionary<string, object>)value, "fingerprintSha256");
            return string.Empty;
        }

        private static string ResolvePath(string value, string baseDirectory)
        {
            if (TextUtility.IsBlank(value)) return string.Empty;
            string path = value.Trim().Trim('"');
            path = path.Replace("${catalina.base}", baseDirectory ?? string.Empty);
            if (Path.IsPathRooted(path)) return Path.GetFullPath(path);
            return Path.GetFullPath(Path.Combine(baseDirectory ?? string.Empty, path));
        }

        private static string[] SplitWords(string value)
        {
            if (TextUtility.IsBlank(value)) return new string[0];
            return value.Split(new char[] { ' ', '\t', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
        }

        private static string[] NormalizeHostNames(string[] values)
        {
            List<string> result = new List<string>();
            foreach (string value in values ?? new string[0])
            {
                if (TextUtility.IsBlank(value) || value == "*") continue;
                string host = value.Trim().Trim('"');
                int colon = host.LastIndexOf(':');
                int port;
                if (colon > 0 && int.TryParse(host.Substring(colon + 1), out port)) host = host.Substring(0, colon);
                if (!TextUtility.IsBlank(host) && !result.Contains(host)) result.Add(host);
            }
            return result.ToArray();
        }

        private static List<string> GetValues(Dictionary<string, string> values, string key)
        {
            List<string> result = new List<string>();
            string value;
            if (!values.TryGetValue(key, out value)) return result;
            result.AddRange(SplitWords(value));
            return result;
        }

        private static string GetValue(Dictionary<string, string> values, string key)
        {
            string value;
            return values.TryGetValue(key, out value) ? value : string.Empty;
        }

        private static string FirstAttribute(XmlElement element, params string[] names)
        {
            return FirstAttribute(element, null, names);
        }

        private static string FirstAttribute(XmlElement primary, XmlElement secondary, params string[] names)
        {
            foreach (string name in names)
            {
                string value = primary == null ? string.Empty : primary.GetAttribute(name);
                if (TextUtility.IsBlank(value) && secondary != null) value = secondary.GetAttribute(name);
                if (!TextUtility.IsBlank(value)) return value;
            }
            return string.Empty;
        }

        private static string FindTomcatHost(XmlDocument document)
        {
            XmlNodeList hosts = document.GetElementsByTagName("Host");
            foreach (XmlElement host in hosts)
            {
                string name = host.GetAttribute("name");
                if (!TextUtility.IsBlank(name)) return name;
            }
            return string.Empty;
        }

        private static string FirstNonBlank(string[] values)
        {
            foreach (string value in values ?? new string[0])
                if (!TextUtility.IsBlank(value) && value != "*") return value;
            return string.Empty;
        }

        private static string Value(Dictionary<string, object> values, string key)
        {
            object value;
            return values != null && values.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : string.Empty;
        }

        private static string[] ParseRoots(string value)
        {
            if (TextUtility.IsBlank(value)) return null;
            List<string> result = new List<string>();
            foreach (string root in value.Split(new char[] { ';', '\n' }, StringSplitOptions.RemoveEmptyEntries))
                if (!TextUtility.IsBlank(root)) result.Add(root.Trim());
            return result.ToArray();
        }

        private sealed class RuntimeServiceFact
        {
            public string Name;
            public string DisplayName;
            public string State;
            public string PathName;
        }

        private sealed class RuntimeProcessFact
        {
            public string Name;
            public string ExecutablePath;
            public string CommandLine;
            public string Version;
        }
    }
}
