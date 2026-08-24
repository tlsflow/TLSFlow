export type FullAgentInstallerPlatform = 'linux-systemd' | 'windows-service';

export interface FullAgentInstallerOptions {
  serviceName?: string;
  displayName?: string;
  description?: string;
  version?: string;
  tenantIdPlaceholder?: string;
  agentKeyPlaceholder?: string;
  controlPlaneUrl?: string;
  linux?: Partial<FullAgentLinuxInstallOptions>;
  windows?: Partial<FullAgentWindowsInstallOptions>;
}

export interface FullAgentLinuxInstallOptions {
  serviceName: string;
  user: string;
  group: string;
  installRoot: string;
  binaryPath: string;
  configDir: string;
  configPath: string;
  dataDir: string;
  logDir: string;
  unitPath: string;
}

export interface FullAgentWindowsInstallOptions {
  serviceName: string;
  displayName: string;
  installRoot: string;
  binaryPath: string;
  configDir: string;
  configPath: string;
  dataDir: string;
  logDir: string;
}

export interface FullAgentLifecycleCommands {
  selfCheck: string;
  healthCheck: string;
  install: string;
  uninstall: string;
  rollbackUninstall: string;
  start: string;
  status: string;
}

export interface FullAgentInstallerArtifact {
  path: string;
  mode: number;
  platform: FullAgentInstallerPlatform | 'all';
  description: string;
  content: string;
}

export interface FullAgentInstallerBundle {
  serviceName: string;
  artifacts: FullAgentInstallerArtifact[];
  linux: {
    options: FullAgentLinuxInstallOptions;
    commands: FullAgentLifecycleCommands;
  };
  windows: {
    options: FullAgentWindowsInstallOptions;
    commands: FullAgentLifecycleCommands;
  };
  notes: string[];
}

export interface WriteFullAgentInstallerBundleOptions extends FullAgentInstallerOptions {
  outputDir: string;
}

export interface WrittenFullAgentInstallerArtifact {
  path: string;
  mode: number;
}

export interface WrittenFullAgentInstallerBundle {
  outputDir: string;
  artifacts: WrittenFullAgentInstallerArtifact[];
  bundle: FullAgentInstallerBundle;
}
