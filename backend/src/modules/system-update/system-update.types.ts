export const updateChannels = ['stable', 'dev'] as const;
export type UpdateChannel = typeof updateChannels[number];

export interface SystemUpdateSettings {
  readonly id: 'singleton';
  readonly channel: UpdateChannel;
  readonly version: number;
  readonly updatedBy?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReleaseImageReferences {
  readonly backend: string;
  readonly web: string;
  readonly browserRuntime?: string;
}

export interface ReleaseChannel {
  readonly version: string;
  readonly publishedAt: string;
  readonly releaseNotes: string;
  readonly images: ReleaseImageReferences;
}

export interface ReleaseManifest {
  readonly schemaVersion: 1;
  readonly product: 'GCAC';
  readonly channels: Record<UpdateChannel, ReleaseChannel>;
}

export type ReleaseRelation = 'current' | 'upgrade' | 'downgrade' | 'channel_switch';

export interface SystemUpdateCheck {
  readonly channel: UpdateChannel;
  readonly currentVersion: string;
  readonly targetVersion: string;
  readonly updateAvailable: boolean;
  readonly relation: ReleaseRelation;
  readonly publishedAt: string;
  readonly releaseNotes: string;
  readonly commands: {
    readonly installScript: string;
    readonly compose: string;
  };
  readonly checkedAt: string;
}
