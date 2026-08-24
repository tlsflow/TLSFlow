# WindowsCompatibilityAgent 构建规则

本文档是 `agents/windows-compat-full-agent` 的固定构建入口。以后只要修改了该目录下的 C# 源码、配置或测试，必须按本文档重新构建并记录验证结果，不再临时寻找编译器或猜测引用程序集。

## 1. 产品与兼容性边界

- 产品线：`windows-compat-full-agent`
- Runtime：`csharp-dotnet-framework`
- 目标运行时：`.NET Framework 3.5.1`
- 支持范围：Windows Server 2008 R2 SP1 至 Windows Server 2012 R2
- 不支持：Windows Server 2003、Windows Server 2003 R2、Windows Server 2008 非 R2
- Agent Core 不执行 PowerShell、CMD、Shell 或下载后执行任务；PowerShell 只用于构建、安装、升级和卸载脚本。

兼容版 Agent 是独立产品线，不能因为本机是 macOS 或现代 Windows 就改用 .NET Core、`dotnet build`、Visual Studio 默认目标框架或 .NET Framework 4.x 运行时替代目标基线。

## 2. 编译规则

`build.ps1` 使用 Windows 自带的 .NET Framework C# 编译器，但必须显式引用 .NET Framework 3.5 Reference Assemblies（引用程序集）：

- 编译器：`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`
- 编译参数：`/noconfig /nostdlib+ /langversion:3 /target:exe /platform:anycpu /optimize+`
- 必须引用：
  - `mscorlib.dll`
  - `System.dll`
  - `System.Core.dll`
  - `System.Management.dll`
  - `System.ServiceProcess.dll`
  - `System.Web.Extensions.dll`
  - `System.Xml.dll`
- `mscorlib.dll` 必须满足：`Name=mscorlib`、`Version=2.0.0.0`

禁止直接引用以下目录中的程序集作为编译基线：

- `C:\Windows\Microsoft.NET\Framework64\v4.0.30319`
- `C:\Windows\Microsoft.NET\Framework\v4.0.30319`
- 任何 .NET Core / .NET 5+ SDK 目录

系统安装了 .NET Framework 3.5 Developer Targeting Pack 时，`build.ps1` 会自动查找；没有安装时，固定使用 NuGet 包 `Microsoft.NETFramework.ReferenceAssemblies.net35`。

## 3. 当前已验证的 Windows 构建机

这是当前可用的构建 VM 连接信息，不包含任何私钥内容：

- 地址：`10.255.0.85`
- SSH 端口：`22`
- 自动化账号：`gcac-build`
- Windows 身份：`jackson-home\gcac-build`
- 主机名：`Jackson-Home`
- 本机私钥路径：`/Users/jackson/.ssh/gcac-windows-build-20260812`
- 编译器已确认存在：`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`

必须使用本地账号 `gcac-build`。不要使用域账号 `jackson` 做自动化构建；该账号实际身份是 `JACKSONZ\jackson`，服务模式曾出现 SID 查询失败（`lookup_sid() failed: 1789`）。

当前 VM 的系统版本实测为 `10.0.19044.6691`，不是 Windows Server 2022。因此它只能证明构建链路和 Windows 运行结果，不能替代 Windows Server 2022 真机验收。

推荐的 SSH 基础参数：

```bash
SSH_OPTS=(-i /Users/jackson/.ssh/gcac-windows-build-20260812 \
  -o IdentitiesOnly=yes \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=accept-new)
REMOTE=(gcac-build@10.255.0.85)
```

不要打印私钥、`.env`、数据库密码或把私钥提交到仓库。

## 4. 固定引用程序集

固定使用 NuGet 包版本 `1.0.3`：

```text
https://api.nuget.org/v3-flatcontainer/microsoft.netframework.referenceassemblies.net35/1.0.3/microsoft.netframework.referenceassemblies.net35.1.0.3.nupkg
```

当前已验证 SHA-256：

```text
b16156111a88670d91a757fbd465fcb4856e034b1a4d523ae2c41a470f3578f9
```

解压后传给 `build.ps1` 的目录必须是：

```text
C:\Users\gcac-build\deps\build\net35-ref\build\.NETFramework\v3.5
```

该目录下应直接存在 `mscorlib.dll`、`System.dll` 等文件。不要把 NuGet 包根目录、`ref` 目录或 Windows 运行时目录误传给 `-ReferenceAssemblyPath`。

## 5. 标准构建流程

以下命令在 macOS 的仓库根目录执行。`stage` 是临时目录，每次构建重新创建。

### 5.1 准备源码和引用包

```bash
set -e
stage=$(mktemp -d /tmp/gcac-windows-agent-build.XXXXXX)

tar -czf "$stage/windows-compat-full-agent.tar.gz" \
  -C agents windows-compat-full-agent

curl -fL --retry 3 \
  --output "$stage/Microsoft.NETFramework.ReferenceAssemblies.net35.1.0.3.nupkg" \
  'https://api.nuget.org/v3-flatcontainer/microsoft.netframework.referenceassemblies.net35/1.0.3/microsoft.netframework.referenceassemblies.net35.1.0.3.nupkg'

printf '%s  %s\n' \
  b16156111a88670d91a757fbd465fcb4856e034b1a4d523ae2c41a470f3578f9 \
  "$stage/Microsoft.NETFramework.ReferenceAssemblies.net35.1.0.3.nupkg" \
  | shasum -a 256 -c -
```

### 5.2 上传到 Windows VM

```bash
ssh "${SSH_OPTS[@]}" "${REMOTE[@]}" \
  'powershell.exe -NoLogo -NoProfile -NonInteractive -Command "New-Item -ItemType Directory -Force -Path \"$env:USERPROFILE\\deps\" | Out-Null"'

scp "${SSH_OPTS[@]}" \
  "$stage/windows-compat-full-agent.tar.gz" \
  "$stage/Microsoft.NETFramework.ReferenceAssemblies.net35.1.0.3.nupkg" \
  "${REMOTE[@]}:/Users/gcac-build/deps/"
```

Windows OpenSSH 会把上面的远端路径映射到 `C:\Users\gcac-build\deps`。

### 5.3 在 VM 解压并执行构建

先进入 VM：

```bash
ssh "${SSH_OPTS[@]}" "${REMOTE[@]}"
```

在 VM 的 PowerShell 中执行：

```powershell
$ErrorActionPreference = "Stop"
$deps = Join-Path $env:USERPROFILE "deps"
$sourceArchive = Join-Path $deps "windows-compat-full-agent.tar.gz"
$referencePackage = Join-Path $deps "Microsoft.NETFramework.ReferenceAssemblies.net35.1.0.3.nupkg"
$buildRoot = Join-Path $deps "build"
$sourceRoot = Join-Path $buildRoot "windows-compat-full-agent"
$referenceRoot = Join-Path $buildRoot "net35-ref"

New-Item -ItemType Directory -Force -Path $buildRoot, $referenceRoot | Out-Null
tar -xzf $sourceArchive -C $buildRoot
tar -xf $referencePackage -C $referenceRoot

$referenceAssemblyPath = Join-Path $referenceRoot "build\.NETFramework\v3.5"
if (-not (Test-Path (Join-Path $referenceAssemblyPath "mscorlib.dll"))) {
    throw "找不到 .NET Framework 3.5 引用程序集"
}

[Reflection.AssemblyName]::GetAssemblyName(
    (Join-Path $referenceAssemblyPath "mscorlib.dll")
).FullName

Set-Location $sourceRoot
& .\build.ps1 -Configuration Release -ReferenceAssemblyPath $referenceAssemblyPath
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Get-ChildItem .\bin\Release | Select-Object Name,Length
& .\bin\Release\GCAC.WindowsCompatibilityAgent.exe --version
Get-FileHash .\bin\Release\GCAC.WindowsCompatibilityAgent.exe -Algorithm SHA256
```

预期结果：

- 引用程序集显示 `mscorlib, Version=2.0.0.0`
- 测试末尾显示 `tests=60 failures=0`
- 显示 `Compatibility Agent build completed`
- `--version` 输出格式为：`windows-compat-full-agent <版本> runtime=csharp-dotnet-framework`

### 5.4 产物清单

构建成功后，`bin\Release` 至少必须包含：

```text
GCAC.WindowsCompatibilityAgent.exe
GCAC.WindowsCompatibilityAgent.exe.config
GCAC.WindowsCompatibilityAgent.Tests.exe
GCAC.WindowsCompatibilityAgent.Tests.exe.config
agent.config.template.json
```

`GCAC.WindowsCompatibilityAgent.pdb` 可用于诊断，随构建产物保留但不作为运行时依赖。

## 6. 回传产物到本机

在 VM 的 PowerShell 中执行：

```powershell
$sourceRoot = Join-Path $env:USERPROFILE "deps\build\windows-compat-full-agent"
$artifact = Join-Path $env:USERPROFILE "deps\windows-compat-release.tar.gz"
tar -czf $artifact -C $sourceRoot bin\Release
Get-FileHash $artifact -Algorithm SHA256
```

退出 VM 后，在 macOS 执行：

```bash
scp "${SSH_OPTS[@]}" \
  "${REMOTE[@]}:/Users/gcac-build/deps/windows-compat-release.tar.gz" \
  "$stage/"

artifact_dir=$(mktemp -d /tmp/gcac-windows-agent-artifact.XXXXXX)
tar -xzf "$stage/windows-compat-release.tar.gz" -C "$artifact_dir"
mkdir -p agents/windows-compat-full-agent/bin
cp -R "$artifact_dir/bin/Release" agents/windows-compat-full-agent/bin/
```

`agents/windows-compat-full-agent/bin/` 被 `.gitignore` 忽略，不要强行提交二进制构建产物。

回传后必须比对 Windows 端和本机文件的 SHA-256，至少检查 `GCAC.WindowsCompatibilityAgent.exe`。

## 7. 可选：生成完整 Agent Release Bundle

只有 Compatibility Agent 构建成功并已回传到 `bin/Release` 后，才执行完整 Bundle：

```bash
node docker/build-agent-release-bundle.mjs
node docker/verify-release-bundle.mjs build/agent-release-bundle
```

Bundle 构建还需要本机可用的 Go 工具链；它会编译 Linux amd64/arm64 和 Windows Modern Agent amd64/arm64，再把同一个 AnyCPU Compatibility Agent 放入 Windows 两个架构目录。验证通过的标准是：

```text
Agent Release Bundle 校验通过
```

当前仓库 `version` 文件为 `1.0.0`，而 Compatibility Agent 源码中的 `ProductIdentity.Version` 当前为 `0.1.11`。二者分别属于 GCAC 产品版本和 Agent 产物版本，必须由各自的发布流程管理；不要在普通修复构建中擅自修改 Agent 版本。

## 8. 失败排查顺序

1. `csc.exe not found`：确认是在 Windows VM 执行，并检查 `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`。
2. `reference assemblies not found`：检查 `-ReferenceAssemblyPath` 是否直接指向 `...\.NETFramework\v3.5`。
3. `Invalid ... mscorlib ... expected Version=2.0.0.0`：重新下载固定 NuGet 包并校验 SHA-256，不要改用 Framework 4.x 目录。
4. `Permission denied (publickey)`：确认使用 `gcac-build` 和指定私钥；不要切换到域账号 `jackson`。
5. 测试失败：保留完整输出，先修复 C# 源码或测试，不得跳过 `build.ps1` 中的测试执行。
6. Bundle 失败且提示 `go: command not found`：这是本机 Go 环境缺失，不是 Windows Agent 编译失败；先准备 Go 工具链，再重新执行 Bundle。
7. 回传后哈希不一致：停止发布，重新传输并核对归档包和目标 EXE 的 SHA-256。

## 9. 修改后的交付门禁

每次修改 `agents/windows-compat-full-agent` 后，交付前必须报告：

- 使用的 Windows 构建机、账号和引用程序集版本
- `build.ps1` 是否成功
- 内置测试数量和失败数
- Agent `--version` 输出
- 主 EXE SHA-256
- 是否生成并通过完整 Agent Release Bundle 校验
- 如果没有 Windows Server 2022 真机，明确写出“未完成 Server 2022 真机验收”
