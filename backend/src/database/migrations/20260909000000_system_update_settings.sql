CREATE TABLE IF NOT EXISTS system_update_settings (
    id varchar(32) PRIMARY KEY,
    channel varchar(16) NOT NULL DEFAULT 'stable',
    version integer NOT NULL DEFAULT 1,
    updated_by varchar(128),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT system_update_settings_singleton CHECK (id = 'singleton'),
    CONSTRAINT system_update_settings_channel CHECK (channel IN ('stable', 'dev')),
    CONSTRAINT system_update_settings_version_positive CHECK (version > 0)
);

INSERT INTO system_update_settings (id, channel, version)
VALUES ('singleton', 'stable', 1)
ON CONFLICT (id) DO NOTHING;
