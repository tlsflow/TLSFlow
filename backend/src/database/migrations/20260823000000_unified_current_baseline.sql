-- GCAC 数据库统一 baseline。
-- 私有仓库与公开仓库共用此文件；来源为当前私有数据库最终 catalog。
-- 该文件不包含 schema_migrations / schema_version_state，迁移运行器会为 baseline 写入唯一账本记录。
-- 初始化种子仅包含默认租户、默认租户成员、风险 SLA 和系统初始化状态。

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.8 (Debian 16.8-1.pgdg120+1)
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', 'public', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: gcac_cutover_backup_20260724; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA gcac_cutover_backup_20260724;


--
-- Name: gcac_plugin_runner_binding_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gcac_plugin_runner_binding_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
declare
  source_version unified_plugin_versions%rowtype;
begin
  select * into source_version
  from unified_plugin_versions
  where id = new.plugin_version_id;

  if not found then
    raise exception 'Plugin Runner binding references a missing PluginVersion';
  end if;
  if source_version.status <> 'ENABLED' then
    raise exception 'Plugin Runner binding references a non-enabled PluginVersion';
  end if;
  if new.tenant_id is distinct from source_version.tenant_id then
    raise exception 'Plugin Runner binding tenant does not match PluginVersion tenant';
  end if;
  if new.canonical_plugin_id is distinct from source_version.plugin_id
     or source_version.manifest->>'canonicalPluginId' is distinct from source_version.plugin_id
     or source_version.manifest->>'pluginId' is distinct from source_version.plugin_id then
    raise exception 'Plugin Runner binding canonical Plugin ID does not match PluginVersion';
  end if;
  if new.plugin_version is distinct from source_version.plugin_version
     or source_version.manifest->>'version' is distinct from source_version.plugin_version then
    raise exception 'Plugin Runner binding PluginVersion is not fixed to the manifest version';
  end if;
  if new.package_sha256 is distinct from source_version.package_sha256
     or new.manifest_sha256 is distinct from source_version.manifest_sha256
     or new.resource_sha256 is distinct from coalesce(source_version.resource_sha256, '{}'::jsonb) then
    raise exception 'Plugin Runner binding artifact hash snapshot does not match PluginVersion';
  end if;
  if jsonb_typeof(new.resource_sha256) <> 'object' then
    raise exception 'Plugin Runner binding contains an invalid resource hash snapshot';
  end if;
  if exists (
    select 1
    from jsonb_each_text(new.resource_sha256) resource_item
    where resource_item.value is null
       or resource_item.value !~ '^sha256:[a-f0-9]{64}$'
  ) then
    raise exception 'Plugin Runner binding contains an invalid resource hash snapshot';
  end if;
  if new.execution_mode <> 'isolated_process'
     or new.protocol_version <> 'gcac.plugin-runner/v1' then
    raise exception 'Plugin Runner binding uses a retired execution contract';
  end if;
  if tg_op = 'UPDATE' and (
    old.tenant_id is distinct from new.tenant_id
    or old.plugin_version_id is distinct from new.plugin_version_id
    or old.canonical_plugin_id is distinct from new.canonical_plugin_id
    or old.plugin_version is distinct from new.plugin_version
    or old.execution_mode is distinct from new.execution_mode
    or old.protocol_version is distinct from new.protocol_version
    or old.package_sha256 is distinct from new.package_sha256
    or old.manifest_sha256 is distinct from new.manifest_sha256
    or old.resource_sha256 is distinct from new.resource_sha256
  ) then
    raise exception 'Plugin Runner binding identity, version, protocol or hash is immutable';
  end if;
  return new;
end;
$_$;


--
-- Name: gcac_plugin_runner_version_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gcac_plugin_runner_version_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if exists (
    select 1 from plugin_runner_version_bindings
    where plugin_version_id = old.id
  ) and (
    old.id is distinct from new.id
    or old.tenant_id is distinct from new.tenant_id
    or old.plugin_id is distinct from new.plugin_id
    or old.plugin_version is distinct from new.plugin_version
    or old.runtime is distinct from new.runtime
    or old.manifest is distinct from new.manifest
    or old.package_sha256 is distinct from new.package_sha256
    or old.manifest_sha256 is distinct from new.manifest_sha256
    or old.resource_sha256 is distinct from new.resource_sha256
  ) then
    raise exception 'Bound PluginVersion identity, runtime, manifest or artifact hash is immutable';
  end if;
  if new.status <> 'ENABLED' then
    delete from plugin_runner_version_bindings
    where plugin_version_id = old.id;
  end if;
  return new;
end;
$$;


--
-- Name: gcac_reject_deployment_input_snapshot_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gcac_reject_deployment_input_snapshot_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  raise exception 'deployment_input_snapshots are immutable';
end;
$$;


--
-- Name: validate_tenant_hierarchy(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_tenant_hierarchy() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  parent_type varchar(16);
  parent_status varchar(32);
  ancestor_id uuid;
  visited_ids uuid[] := array[new.id];
begin
  if new.status = 'SUSPENDED'
     and exists (
       select 1
         from tenants
        where parent_id = new.id
          and status = 'ACTIVE'
     ) then
    raise exception '存在有效子公司时不能停用父租户' using errcode = '23514';
  end if;

  if new.parent_id is null then
    return new;
  end if;

  select tenant_type, status
    into parent_type, parent_status
    from tenants
   where id = new.parent_id;

  if parent_type is null then
    raise exception '租户父节点不存在' using errcode = '23503';
  end if;

  if new.tenant_type <> 'COMPANY' or parent_type <> 'GROUP' then
    raise exception '首期只允许 GROUP -> COMPANY 租户关系' using errcode = '23514';
  end if;

  if parent_status <> 'ACTIVE' then
    raise exception '租户父节点未启用' using errcode = '23514';
  end if;

  ancestor_id := new.parent_id;
  while ancestor_id is not null loop
    if ancestor_id = any(visited_ids) then
      raise exception '租户父子关系不能形成循环' using errcode = '23514';
    end if;

    visited_ids := array_append(visited_ids, ancestor_id);
    select parent_id
      into ancestor_id
      from tenants
     where id = ancestor_id;
  end loop;

  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: pg_device_assets; Type: TABLE; Schema: gcac_cutover_backup_20260724; Owner: -
--

CREATE TABLE gcac_cutover_backup_20260724.pg_device_assets (
    service_asset_id text,
    tenant_id text,
    device_family character varying(64),
    management_port integer,
    credential_id text,
    auth_mode character varying(24),
    tls_verify boolean,
    ca_secret_id text,
    gateway_id text,
    product_name text,
    software_version character varying(32),
    software_build text,
    runtime_mode text,
    ha_mode text,
    support_tier character varying(24),
    capability_profile jsonb,
    last_discovered_at timestamp with time zone,
    last_error_code text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    version integer,
    host_id text,
    plugin_version_id text,
    plugin_binding_id text,
    product_family text,
    metadata jsonb
);


--
-- Name: pg_device_certificate_bindings; Type: TABLE; Schema: gcac_cutover_backup_20260724; Owner: -
--

CREATE TABLE gcac_cutover_backup_20260724.pg_device_certificate_bindings (
    id text,
    tenant_id text,
    device_asset_id text,
    virtual_server_id text,
    certificate_resource_id text,
    binding_key text,
    sni_certificate boolean,
    priority integer,
    desired_certificate_version_id text,
    observed_fingerprint_sha256 character varying(64),
    desired_fingerprint_sha256 character varying(64),
    drift_state character varying(24),
    metadata jsonb,
    last_verified_at timestamp with time zone,
    last_deployed_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    version integer
);


--
-- Name: pg_device_certificate_resources; Type: TABLE; Schema: gcac_cutover_backup_20260724; Owner: -
--

CREATE TABLE gcac_cutover_backup_20260724.pg_device_certificate_resources (
    id text,
    tenant_id text,
    device_asset_id text,
    certkey_name text,
    certificate_path text,
    private_key_path text,
    subject text,
    issuer text,
    serial_number text,
    not_before timestamp with time zone,
    not_after timestamp with time zone,
    remote_status text,
    signature_algorithm text,
    public_key_algorithm text,
    public_key_size integer,
    linked_certkey_name text,
    fingerprint_sha256 character varying(64),
    source_version text,
    metadata jsonb,
    last_discovered_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    version integer
);


--
-- Name: pg_device_virtual_servers; Type: TABLE; Schema: gcac_cutover_backup_20260724; Owner: -
--

CREATE TABLE gcac_cutover_backup_20260724.pg_device_virtual_servers (
    id text,
    tenant_id text,
    device_asset_id text,
    virtual_server_type character varying(16),
    virtual_server_name text,
    target_key text,
    address text,
    port integer,
    protocol text,
    runtime_state text,
    sni_names jsonb,
    metadata jsonb,
    last_discovered_at timestamp with time zone,
    status character varying(24),
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    version integer
);


--
-- Name: pg_hosts; Type: TABLE; Schema: gcac_cutover_backup_20260724; Owner: -
--

CREATE TABLE gcac_cutover_backup_20260724.pg_hosts (
    id text,
    tenant_id text,
    hostname character varying(255),
    display_name character varying(255),
    primary_ip text,
    ip_addresses jsonb,
    os_type character varying(32),
    os_name character varying(128),
    os_version character varying(128),
    arch character varying(64),
    environment character varying(32),
    zone_id text,
    owner_id text,
    management_channels jsonb,
    discovery_source character varying(32),
    last_discovered_at timestamp with time zone,
    agent_id text,
    asset_fingerprint text,
    compatibility_level character varying(8),
    management_mode character varying(32),
    status character varying(32),
    tags jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    version integer
);


--
-- Name: pg_managed_targets; Type: TABLE; Schema: gcac_cutover_backup_20260724; Owner: -
--

CREATE TABLE gcac_cutover_backup_20260724.pg_managed_targets (
    id text,
    tenant_id text,
    agent_id text,
    host_id text,
    service_instance_id text,
    service_asset_id text,
    site_asset_id text,
    provider_type character varying(64),
    framework_type character varying(64),
    target_type character varying(32),
    target_key text,
    binding_key text,
    capability_profile jsonb,
    deployment_mode text,
    last_seen_at timestamp with time zone,
    status character varying(32),
    metadata jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    version integer,
    device_asset_id text
);


--
-- Name: pg_service_assets; Type: TABLE; Schema: gcac_cutover_backup_20260724; Owner: -
--

CREATE TABLE gcac_cutover_backup_20260724.pg_service_assets (
    id text,
    tenant_id text,
    address character varying(255),
    address_type character varying(16),
    port integer,
    protocol character varying(16),
    sni_name character varying(255),
    display_name character varying(255),
    service_instance_id text,
    service_endpoint_id text,
    host_id text,
    environment character varying(32),
    discovery_source character varying(32),
    last_discovered_at timestamp with time zone,
    status character varying(32),
    tags jsonb,
    metadata jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    version integer,
    platform character varying(16),
    agent_id text,
    asset_kind character varying(16)
);


--
-- Name: pg_site_assets; Type: TABLE; Schema: gcac_cutover_backup_20260724; Owner: -
--

CREATE TABLE gcac_cutover_backup_20260724.pg_site_assets (
    id text,
    tenant_id text,
    service_instance_id text,
    service_asset_id text,
    host_id text,
    agent_id text,
    provider_type character varying(64),
    site_type character varying(32),
    site_name text,
    site_key text,
    binding_information text,
    host_header text,
    listen_ip text,
    port integer,
    protocol character varying(16),
    config_path text,
    runtime_status text,
    discovery_source character varying(32),
    last_discovered_at timestamp with time zone,
    status character varying(32),
    metadata jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    version integer
);


--
-- Name: agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    host_id uuid,
    agent_type character varying(32) NOT NULL,
    agent_version character varying(64) NOT NULL,
    install_id character varying(128) NOT NULL,
    status character varying(32) DEFAULT 'UNKNOWN'::character varying NOT NULL,
    last_seen_at timestamp with time zone,
    protocol_version character varying(32) NOT NULL,
    public_key_fingerprint character varying(128),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT agents_agent_type_check CHECK (((agent_type)::text = ANY ((ARRAY['FULL'::character varying, 'GATEWAY'::character varying])::text[]))),
    CONSTRAINT agents_status_check CHECK (((status)::text = ANY ((ARRAY['ONLINE'::character varying, 'OFFLINE'::character varying, 'DISABLED'::character varying, 'UPGRADING'::character varying, 'UNKNOWN'::character varying])::text[]))),
    CONSTRAINT agents_version_check CHECK ((version > 0))
);


--
-- Name: app_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_documents (
    namespace character varying(128) NOT NULL,
    document_id character varying(128) NOT NULL,
    payload jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: application_onboarding_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_onboarding_sessions (
    id text NOT NULL,
    tenant_id text NOT NULL,
    actor_id text NOT NULL,
    platform_key text NOT NULL,
    plugin_version_id text,
    recipe_hash text,
    state text NOT NULL,
    state_version integer DEFAULT 1 NOT NULL,
    deployment_mode text,
    device_id text,
    asset_id text,
    discovery_snapshot_id text,
    target_id text,
    target_fingerprint text,
    certificate_id text,
    certificate_version_id text,
    input_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    targets jsonb DEFAULT '[]'::jsonb NOT NULL,
    result jsonb,
    last_error_code text,
    last_error_detail jsonb,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT application_onboarding_sessions_mode_check CHECK (((deployment_mode IS NULL) OR (deployment_mode = ANY (ARRAY['MANAGED_TARGET'::text, 'DIRECT_WORKFLOW'::text])))),
    CONSTRAINT application_onboarding_sessions_state_check CHECK ((state = ANY (ARRAY['CREATED'::text, 'PLATFORM_SELECTED'::text, 'RESOURCE_SELECTION_REQUIRED'::text, 'DEVICE_INPUT_REQUIRED'::text, 'DEVICE_ONBOARDING'::text, 'WAITING_AGENT'::text, 'CONNECTION_TESTING'::text, 'DISCOVERING'::text, 'TARGET_SELECTION_REQUIRED'::text, 'CERTIFICATE_SELECTION_REQUIRED'::text, 'READY_TO_COMMIT'::text, 'COMMITTING'::text, 'PLAN_CREATED'::text, 'FAILED'::text, 'CANCELLED'::text]))),
    CONSTRAINT application_onboarding_sessions_state_version_check CHECK ((state_version > 0))
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    actor_type character varying(32) NOT NULL,
    actor_id uuid,
    action character varying(128) NOT NULL,
    resource_type character varying(64) NOT NULL,
    resource_id uuid,
    request_id character varying(128),
    before_snapshot jsonb,
    after_snapshot jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_events_actor_type_check CHECK (((actor_type)::text = ANY ((ARRAY['USER'::character varying, 'SYSTEM'::character varying, 'AGENT'::character varying, 'PLUGIN'::character varying])::text[])))
);


--
-- Name: automation_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_definitions (
    id text NOT NULL,
    tenant_id text NOT NULL,
    name text NOT NULL,
    description text,
    status character varying(16) NOT NULL,
    current_version integer NOT NULL,
    next_run_at timestamp with time zone,
    last_run_at timestamp with time zone,
    created_by text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT automation_definitions_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'disabled'::character varying, 'deleted'::character varying])::text[])))
);


--
-- Name: automation_run_action_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_run_action_results (
    id text NOT NULL,
    tenant_id text NOT NULL,
    run_id text NOT NULL,
    run_target_id text,
    action_type text NOT NULL,
    action_position integer NOT NULL,
    status character varying(16) NOT NULL,
    external_reference_type text,
    external_reference_id text,
    failure_stage character varying(32),
    error_code text,
    error_message text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT automation_run_action_results_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'succeeded'::character varying, 'failed'::character varying, 'skipped'::character varying])::text[])))
);


--
-- Name: automation_run_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_run_targets (
    id text NOT NULL,
    tenant_id text NOT NULL,
    run_id text NOT NULL,
    sequence_no integer NOT NULL,
    target_snapshot jsonb NOT NULL,
    environment_snapshot text,
    action_types jsonb NOT NULL,
    status character varying(32) NOT NULL,
    current_action text,
    failure_stage character varying(32),
    deployment_plan_id text,
    execution_run_id text,
    notification_request_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    error_code text,
    error_message text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT automation_run_targets_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'waiting_approval'::character varying, 'succeeded'::character varying, 'failed'::character varying, 'skipped'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: automation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_runs (
    id text NOT NULL,
    tenant_id text NOT NULL,
    automation_id text NOT NULL,
    automation_version integer NOT NULL,
    automation_name_snapshot text NOT NULL,
    trigger_type character varying(64) NOT NULL,
    scheduled_at timestamp with time zone,
    idempotency_key text NOT NULL,
    parent_run_id text,
    status character varying(32) NOT NULL,
    target_summary jsonb NOT NULL,
    action_types jsonb NOT NULL,
    environment_snapshots jsonb DEFAULT '[]'::jsonb NOT NULL,
    failure_stage character varying(32),
    failure_code text,
    failure_message text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_by text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    trigger_context jsonb,
    approval_id text,
    delivery_id text,
    execution_options jsonb,
    CONSTRAINT automation_runs_status_check CHECK (((status)::text = ANY ((ARRAY['queued'::character varying, 'running'::character varying, 'waiting_approval'::character varying, 'succeeded'::character varying, 'partially_succeeded'::character varying, 'failed'::character varying, 'needs_attention'::character varying, 'stopped'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT automation_runs_trigger_type_check CHECK (((trigger_type)::text = ANY ((ARRAY['schedule'::character varying, 'on_demand'::character varying, 'retry'::character varying, 'certificate_version_created'::character varying])::text[])))
);


--
-- Name: automation_scheduler_leases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_scheduler_leases (
    lease_key text NOT NULL,
    owner_id text NOT NULL,
    leased_until timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: automation_trigger_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_trigger_deliveries (
    id text NOT NULL,
    tenant_id text NOT NULL,
    automation_id text NOT NULL,
    automation_version integer NOT NULL,
    delivery_key text NOT NULL,
    trigger_type character varying(64) NOT NULL,
    event_type text,
    payload jsonb NOT NULL,
    status character varying(32) NOT NULL,
    run_id text,
    approval_id text,
    error_code text,
    error_message text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT automation_trigger_deliveries_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'matched'::character varying, 'waiting_approval'::character varying, 'run_created'::character varying, 'skipped'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: automation_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_versions (
    id text NOT NULL,
    tenant_id text NOT NULL,
    automation_id text NOT NULL,
    version integer NOT NULL,
    trigger_config jsonb NOT NULL,
    actions jsonb NOT NULL,
    guardrails jsonb NOT NULL,
    checksum character(64) NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    filters jsonb DEFAULT '[]'::jsonb NOT NULL,
    target_resolver jsonb NOT NULL,
    approval_stage jsonb,
    CONSTRAINT automation_versions_target_resolver_type_check CHECK (((target_resolver ->> 'type'::text) = 'certificate_version_targets'::text))
);


--
-- Name: backup_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backup_artifacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    execution_run_id uuid NOT NULL,
    certificate_binding_id uuid NOT NULL,
    artifact_type character varying(32) NOT NULL,
    artifact_ref character varying(256) NOT NULL,
    checksum_sha256 character(64),
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT backup_artifacts_artifact_type_check CHECK (((artifact_type)::text = ANY ((ARRAY['FILE'::character varying, 'CERT_STORE'::character varying, 'KEYSTORE'::character varying, 'CONFIG'::character varying, 'DEVICE_CONFIG'::character varying])::text[]))),
    CONSTRAINT backup_artifacts_version_check CHECK ((version > 0)),
    CONSTRAINT ck_backup_artifacts_checksum CHECK (((checksum_sha256 IS NULL) OR (checksum_sha256 ~ '^[0-9a-f]{64}$'::text)))
);


--
-- Name: browser_credential_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.browser_credential_sessions (
    id text NOT NULL,
    tenant_id text NOT NULL,
    asset_id text NOT NULL,
    plugin_version_id text NOT NULL,
    workflow_template_id text NOT NULL,
    workflow_version_id text NOT NULL,
    capability_key text NOT NULL,
    runtime_session_id text NOT NULL,
    one_time_url_hash text NOT NULL,
    idempotency_key_hash text,
    status text NOT NULL,
    credential_profile_id text,
    expires_at timestamp with time zone NOT NULL,
    created_by text NOT NULL,
    last_error_code text,
    last_error_message text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    share_password_salt text,
    share_password_hash text,
    login_url text,
    CONSTRAINT browser_credential_sessions_capability_key_check CHECK ((capability_key = 'credential.acquire'::text)),
    CONSTRAINT browser_credential_sessions_status_check CHECK ((status = ANY (ARRAY['created'::text, 'ready'::text, 'acquiring'::text, 'succeeded'::text, 'failed'::text, 'expired'::text, 'closed'::text])))
);


--
-- Name: certificate_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.certificate_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(256) NOT NULL,
    primary_domain character varying(255) NOT NULL,
    domain_pattern character varying(255),
    source_type character varying(32) NOT NULL,
    owner_team character varying(128),
    environment character varying(32),
    status character varying(32) DEFAULT 'ACTIVE'::character varying NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT certificate_assets_source_type_check CHECK (((source_type)::text = ANY ((ARRAY['MANUAL'::character varying, 'ACME'::character varying, 'ENTERPRISE_CA'::character varying, 'EXTERNAL_API'::character varying, 'CERTD'::character varying, 'ALLINSSL'::character varying])::text[]))),
    CONSTRAINT certificate_assets_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'ARCHIVED'::character varying])::text[]))),
    CONSTRAINT certificate_assets_version_check CHECK ((version > 0)),
    CONSTRAINT ck_certificate_assets_primary_domain_lower CHECK (((primary_domain)::text = lower((primary_domain)::text)))
);


--
-- Name: certificate_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.certificate_bindings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    service_instance_id uuid NOT NULL,
    service_endpoint_id uuid,
    domain_name character varying(255),
    binding_type character varying(32) NOT NULL,
    certificate_version_id uuid,
    observed_fingerprint_sha256 character(64),
    desired_fingerprint_sha256 character(64),
    cert_path text,
    key_path text,
    chain_path text,
    keystore_path text,
    keystore_type character varying(32),
    store_location character varying(64),
    store_name character varying(64),
    store_thumbprint character varying(128),
    reload_command text,
    verify_method character varying(32) NOT NULL,
    last_verified_at timestamp with time zone,
    last_deployed_at timestamp with time zone,
    status character varying(32) DEFAULT 'DISCOVERED'::character varying NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT certificate_bindings_binding_type_check CHECK (((binding_type)::text = ANY ((ARRAY['FILE_PATH'::character varying, 'WINDOWS_CERT_STORE'::character varying, 'KEYSTORE'::character varying, 'DEVICE_API'::character varying, 'CUSTOM'::character varying])::text[]))),
    CONSTRAINT certificate_bindings_keystore_type_check CHECK (((keystore_type IS NULL) OR ((keystore_type)::text = ANY ((ARRAY['JKS'::character varying, 'PKCS12'::character varying])::text[])))),
    CONSTRAINT certificate_bindings_status_check CHECK (((status)::text = ANY ((ARRAY['DISCOVERED'::character varying, 'MANAGED'::character varying, 'DRIFTED'::character varying, 'EXPIRED'::character varying, 'ERROR'::character varying, 'IGNORED'::character varying])::text[]))),
    CONSTRAINT certificate_bindings_verify_method_check CHECK (((verify_method)::text = ANY ((ARRAY['TLS_CONNECT'::character varying, 'LOCAL_FILE'::character varying, 'STORE_QUERY'::character varying, 'CUSTOM'::character varying])::text[]))),
    CONSTRAINT certificate_bindings_version_check CHECK ((version > 0)),
    CONSTRAINT ck_certificate_bindings_desired_fp CHECK (((desired_fingerprint_sha256 IS NULL) OR (desired_fingerprint_sha256 ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT ck_certificate_bindings_domain_lower CHECK (((domain_name IS NULL) OR ((domain_name)::text = lower((domain_name)::text)))),
    CONSTRAINT ck_certificate_bindings_location CHECK (((((binding_type)::text = 'FILE_PATH'::text) AND (cert_path IS NOT NULL)) OR (((binding_type)::text = 'KEYSTORE'::text) AND (keystore_path IS NOT NULL)) OR (((binding_type)::text = 'WINDOWS_CERT_STORE'::text) AND (store_location IS NOT NULL) AND (store_name IS NOT NULL)) OR ((binding_type)::text = ANY ((ARRAY['DEVICE_API'::character varying, 'CUSTOM'::character varying])::text[])))),
    CONSTRAINT ck_certificate_bindings_observed_fp CHECK (((observed_fingerprint_sha256 IS NULL) OR (observed_fingerprint_sha256 ~ '^[0-9a-f]{64}$'::text)))
);


--
-- Name: certificate_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.certificate_observations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    monitor_target_id uuid NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    fingerprint_sha256 character(64),
    not_after timestamp with time zone,
    chain_valid boolean,
    hostname_valid boolean,
    raw_result jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT ck_certificate_observations_fp CHECK (((fingerprint_sha256 IS NULL) OR (fingerprint_sha256 ~ '^[0-9a-f]{64}$'::text)))
);


--
-- Name: certificate_version_formats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.certificate_version_formats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    certificate_version_id uuid NOT NULL,
    format character varying(32) NOT NULL,
    artifact_ref character varying(256) NOT NULL,
    password_secret_ref character varying(256),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT certificate_version_formats_format_check CHECK (((format)::text = ANY ((ARRAY['PEM'::character varying, 'PFX'::character varying, 'JKS'::character varying, 'DER'::character varying, 'P7B'::character varying])::text[]))),
    CONSTRAINT certificate_version_formats_version_check CHECK ((version > 0))
);


--
-- Name: certificate_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.certificate_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    certificate_asset_id uuid NOT NULL,
    version_no integer NOT NULL,
    format character varying(32) NOT NULL,
    common_name character varying(255),
    sans jsonb DEFAULT '[]'::jsonb NOT NULL,
    issuer character varying(512),
    subject character varying(512),
    serial_number character varying(128) NOT NULL,
    fingerprint_sha256 character(64) NOT NULL,
    not_before timestamp with time zone NOT NULL,
    not_after timestamp with time zone NOT NULL,
    has_private_key boolean DEFAULT false NOT NULL,
    private_key_secret_ref character varying(256),
    cert_secret_ref character varying(256) NOT NULL,
    chain_secret_ref character varying(256),
    import_batch_id uuid,
    status character varying(32) NOT NULL,
    parse_warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT certificate_versions_format_check CHECK (((format)::text = ANY ((ARRAY['PEM'::character varying, 'PFX'::character varying, 'JKS'::character varying, 'DER'::character varying, 'P7B'::character varying])::text[]))),
    CONSTRAINT certificate_versions_status_check CHECK (((status)::text = ANY ((ARRAY['VALID'::character varying, 'EXPIRED'::character varying, 'REVOKED'::character varying, 'MALFORMED'::character varying, 'ARCHIVED'::character varying])::text[]))),
    CONSTRAINT certificate_versions_version_check CHECK ((version > 0)),
    CONSTRAINT certificate_versions_version_no_check CHECK ((version_no > 0)),
    CONSTRAINT ck_certificate_versions_fingerprint_lower_hex CHECK ((fingerprint_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_certificate_versions_private_key_ref CHECK ((((has_private_key = false) AND (private_key_secret_ref IS NULL)) OR ((has_private_key = true) AND (private_key_secret_ref IS NOT NULL)))),
    CONSTRAINT ck_certificate_versions_time_range CHECK ((not_after > not_before))
);


--
-- Name: credential_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credential_profiles (
    id text NOT NULL,
    tenant_id text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    scope_type text NOT NULL,
    scope_id text,
    username text,
    delivery jsonb DEFAULT '{}'::jsonb NOT NULL,
    secret_slots jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT credential_profiles_delivery_object CHECK ((jsonb_typeof(delivery) = 'object'::text)),
    CONSTRAINT credential_profiles_kind_check CHECK ((kind = ANY (ARRAY['USERNAME_PASSWORD'::text, 'SSH_KEY'::text, 'BEARER_TOKEN'::text, 'API_KEY'::text, 'CLIENT_CERTIFICATE'::text, 'DNS_PROVIDER'::text, 'CLOUD_PROVIDER'::text, 'BROWSER_SESSION'::text]))),
    CONSTRAINT credential_profiles_metadata_object CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT credential_profiles_name CHECK ((length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT credential_profiles_scope CHECK ((((scope_type = 'global'::text) AND (scope_id IS NULL)) OR ((scope_type <> 'global'::text) AND (scope_id IS NOT NULL) AND (length(TRIM(BOTH FROM scope_id)) > 0)))),
    CONSTRAINT credential_profiles_scope_type_check CHECK ((scope_type = ANY (ARRAY['global'::text, 'team'::text, 'zone'::text, 'host'::text, 'plugin'::text]))),
    CONSTRAINT credential_profiles_secret_slots_object CHECK ((jsonb_typeof(secret_slots) = 'object'::text)),
    CONSTRAINT credential_profiles_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'error'::text]))),
    CONSTRAINT credential_profiles_version_check CHECK ((version > 0))
);


--
-- Name: database_forward_cleanup_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.database_forward_cleanup_audits (
    migration_version character varying(32) NOT NULL,
    source_table character varying(128) NOT NULL,
    source_namespace character varying(128) DEFAULT ''::character varying NOT NULL,
    source_id character varying(512) NOT NULL,
    cleanup_action character varying(32) NOT NULL,
    reason character varying(128) NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    audit_id character varying(128) NOT NULL
);


--
-- Name: deployment_input_artifact_binding_migration_backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deployment_input_artifact_binding_migration_backups (
    plugin_binding_id text NOT NULL,
    tenant_id text NOT NULL,
    original_input_bindings jsonb NOT NULL,
    original_version integer NOT NULL,
    backed_up_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: deployment_input_binding_repair_backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deployment_input_binding_repair_backups (
    plugin_binding_id text NOT NULL,
    tenant_id text NOT NULL,
    application_asset_id text NOT NULL,
    capability_key text NOT NULL,
    original_plugin_version_id text NOT NULL,
    original_input_bindings jsonb NOT NULL,
    original_managed_context jsonb,
    original_version integer NOT NULL,
    backed_up_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: deployment_input_binding_repairs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deployment_input_binding_repairs (
    tenant_id text NOT NULL,
    application_asset_id text NOT NULL,
    capability_key text NOT NULL,
    plugin_binding_id text NOT NULL,
    previous_plugin_version_id text NOT NULL,
    current_plugin_version_id text NOT NULL,
    status text NOT NULL,
    issues jsonb DEFAULT '{}'::jsonb NOT NULL,
    repaired_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT deployment_input_binding_repairs_status_check CHECK ((status = ANY (ARRAY['REPAIRED'::text, 'UNRESOLVED'::text])))
);


--
-- Name: deployment_input_binding_sanitization_backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deployment_input_binding_sanitization_backups (
    plugin_binding_id text NOT NULL,
    tenant_id text NOT NULL,
    original_input_bindings jsonb NOT NULL,
    original_version integer NOT NULL,
    sanitized_input_bindings jsonb NOT NULL,
    backed_up_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: deployment_input_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deployment_input_snapshots (
    id text NOT NULL,
    tenant_id text NOT NULL,
    deployment_plan_id text NOT NULL,
    deployment_plan_target_id text NOT NULL,
    revision integer NOT NULL,
    snapshot jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    created_by text NOT NULL,
    sealed_runtime_payload jsonb,
    CONSTRAINT ck_deployment_input_snapshots_v1 CHECK ((((snapshot ->> 'apiVersion'::text) = 'gcac.deployment-input-snapshot/v1'::text) AND ((snapshot ->> 'snapshotVersion'::text) = '1'::text) AND (jsonb_typeof((snapshot -> 'input'::text)) = 'object'::text) AND (jsonb_typeof((snapshot -> 'sources'::text)) = 'object'::text) AND (jsonb_typeof((snapshot -> 'sensitivePaths'::text)) = 'array'::text) AND (jsonb_typeof((snapshot -> 'identity'::text)) = 'object'::text) AND (jsonb_typeof((snapshot -> 'redaction'::text)) = 'object'::text) AND (NOT (snapshot ? 'resolvedInput'::text)) AND (NOT (snapshot ? 'resolvedDeploymentInput'::text)) AND (NOT (snapshot ? 'contract'::text)) AND (NOT (snapshot ? 'effectiveBinding'::text)) AND ((sealed_runtime_payload IS NULL) OR ((jsonb_typeof(sealed_runtime_payload) = 'object'::text) AND ((sealed_runtime_payload ->> 'algorithm'::text) = 'aes-256-gcm'::text) AND (sealed_runtime_payload ? 'encryptedData'::text) AND (sealed_runtime_payload ? 'encryptedDek'::text) AND (sealed_runtime_payload ? 'authTag'::text))))),
    CONSTRAINT deployment_input_snapshots_revision_check CHECK ((revision > 0))
);


--
-- Name: deployment_plan_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deployment_plan_targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    deployment_plan_id uuid NOT NULL,
    certificate_binding_id uuid NOT NULL,
    execution_target_id uuid,
    required_capabilities jsonb DEFAULT '[]'::jsonb NOT NULL,
    match_result jsonb,
    status character varying(32) DEFAULT 'PENDING'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT deployment_plan_targets_status_check CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'READY'::character varying, 'SKIPPED'::character varying, 'FAILED'::character varying, 'COMPLETED'::character varying])::text[]))),
    CONSTRAINT deployment_plan_targets_version_check CHECK ((version > 0))
);


--
-- Name: deployment_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deployment_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(256) NOT NULL,
    plan_type character varying(32) NOT NULL,
    certificate_version_id uuid,
    status character varying(32) NOT NULL,
    approval_status character varying(32) DEFAULT 'NOT_REQUIRED'::character varying NOT NULL,
    scheduled_at timestamp with time zone,
    created_reason character varying(64) NOT NULL,
    options jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT deployment_plans_approval_status_check CHECK (((approval_status)::text = ANY ((ARRAY['NOT_REQUIRED'::character varying, 'PENDING'::character varying, 'APPROVED'::character varying, 'REJECTED'::character varying])::text[]))),
    CONSTRAINT deployment_plans_created_reason_check CHECK (((created_reason)::text = ANY ((ARRAY['MANUAL'::character varying, 'AUTO_RENEW'::character varying, 'RISK_FIX'::character varying, 'ROLLBACK'::character varying])::text[]))),
    CONSTRAINT deployment_plans_plan_type_check CHECK (((plan_type)::text = ANY ((ARRAY['INSTALL'::character varying, 'UPDATE'::character varying, 'ROLLBACK'::character varying, 'VERIFY_ONLY'::character varying])::text[]))),
    CONSTRAINT deployment_plans_status_check CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'PENDING_APPROVAL'::character varying, 'READY'::character varying, 'RUNNING'::character varying, 'SUCCESS'::character varying, 'PARTIAL_SUCCESS'::character varying, 'FAILED'::character varying, 'CANCELLED'::character varying, 'ROLLED_BACK'::character varying])::text[]))),
    CONSTRAINT deployment_plans_version_check CHECK ((version > 0))
);


--
-- Name: execution_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.execution_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    deployment_plan_id uuid NOT NULL,
    execution_target_id uuid,
    run_no integer NOT NULL,
    idempotency_key character varying(128) NOT NULL,
    external_run_id character varying(128),
    status character varying(32) NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    error_code character varying(64),
    error_message text,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT execution_runs_run_no_check CHECK ((run_no > 0)),
    CONSTRAINT execution_runs_status_check CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'DISPATCHED'::character varying, 'RUNNING'::character varying, 'SUCCESS'::character varying, 'FAILED'::character varying, 'TIMEOUT'::character varying, 'CANCELLED'::character varying, 'ROLLBACK_RUNNING'::character varying, 'ROLLBACK_SUCCESS'::character varying, 'ROLLBACK_FAILED'::character varying])::text[]))),
    CONSTRAINT execution_runs_version_check CHECK ((version > 0))
);


--
-- Name: execution_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.execution_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    execution_run_id uuid NOT NULL,
    step_no integer NOT NULL,
    step_type character varying(64) NOT NULL,
    name character varying(128) NOT NULL,
    input_snapshot jsonb,
    status character varying(32) DEFAULT 'PENDING'::character varying NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT execution_steps_status_check CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'RUNNING'::character varying, 'SUCCESS'::character varying, 'FAILED'::character varying, 'SKIPPED'::character varying, 'TIMEOUT'::character varying])::text[]))),
    CONSTRAINT execution_steps_step_no_check CHECK ((step_no > 0)),
    CONSTRAINT execution_steps_step_type_check CHECK (((step_type)::text = ANY ((ARRAY['DISCOVER'::character varying, 'BACKUP'::character varying, 'INSTALL'::character varying, 'RELOAD'::character varying, 'VERIFY'::character varying, 'ROLLBACK'::character varying, 'CUSTOM'::character varying])::text[]))),
    CONSTRAINT execution_steps_version_check CHECK ((version > 0))
);


--
-- Name: execution_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.execution_targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    target_kind character varying(32) NOT NULL,
    host_id uuid,
    agent_id uuid,
    gateway_id uuid,
    endpoint character varying(512),
    credential_secret_ref character varying(256),
    status character varying(32) DEFAULT 'UNKNOWN'::character varying NOT NULL,
    last_checked_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT ck_execution_targets_route CHECK (((host_id IS NOT NULL) OR (agent_id IS NOT NULL) OR (gateway_id IS NOT NULL) OR (endpoint IS NOT NULL))),
    CONSTRAINT execution_targets_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'DISABLED'::character varying, 'FAILED'::character varying, 'UNKNOWN'::character varying])::text[]))),
    CONSTRAINT execution_targets_target_kind_check CHECK (((target_kind)::text = ANY ((ARRAY['AGENT'::character varying, 'GATEWAY_FORWARD'::character varying, 'SSH'::character varying, 'WINRM'::character varying, 'SMB_WMI'::character varying, 'CURL'::character varying, 'WORKFLOW'::character varying, 'TRUSTED_JS'::character varying])::text[]))),
    CONSTRAINT execution_targets_version_check CHECK ((version > 0))
);


--
-- Name: gateways; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gateways (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    zone_id uuid NOT NULL,
    name character varying(128) NOT NULL,
    status character varying(32) DEFAULT 'OFFLINE'::character varying NOT NULL,
    routing_policy jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gateways_status_check CHECK (((status)::text = ANY ((ARRAY['ONLINE'::character varying, 'OFFLINE'::character varying, 'DISABLED'::character varying])::text[]))),
    CONSTRAINT gateways_version_check CHECK ((version > 0))
);


--
-- Name: hosts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hosts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    hostname character varying(255) NOT NULL,
    display_name character varying(255),
    primary_ip inet,
    ip_addresses jsonb DEFAULT '[]'::jsonb NOT NULL,
    os_type character varying(32) NOT NULL,
    os_name character varying(128),
    os_version character varying(128),
    arch character varying(64),
    environment character varying(32),
    zone_id uuid,
    compatibility_level character varying(8) NOT NULL,
    management_mode character varying(32) NOT NULL,
    status character varying(32) DEFAULT 'ACTIVE'::character varying NOT NULL,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT hosts_compatibility_level_check CHECK (((compatibility_level)::text = ANY ((ARRAY['L1'::character varying, 'L2'::character varying, 'L3'::character varying, 'L4'::character varying, 'L5'::character varying])::text[]))),
    CONSTRAINT hosts_management_mode_check CHECK (((management_mode)::text = ANY ((ARRAY['AGENT'::character varying, 'GATEWAY'::character varying, 'AGENTLESS'::character varying, 'MONITOR_ONLY'::character varying])::text[]))),
    CONSTRAINT hosts_os_type_check CHECK (((os_type)::text = ANY ((ARRAY['WINDOWS'::character varying, 'LINUX'::character varying, 'UNIX'::character varying, 'NETWORK_DEVICE'::character varying, 'UNKNOWN'::character varying])::text[]))),
    CONSTRAINT hosts_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'INACTIVE'::character varying, 'UNKNOWN'::character varying, 'RETIRED'::character varying])::text[]))),
    CONSTRAINT hosts_version_check CHECK ((version > 0))
);


--
-- Name: idempotency_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_records (
    id text NOT NULL,
    tenant_id text NOT NULL,
    action_type text NOT NULL,
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    status_code integer NOT NULL,
    response_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT idempotency_records_status_code_check CHECK (((status_code >= 100) AND (status_code <= 599)))
);


--
-- Name: job_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_queue (
    job_id character varying(128) NOT NULL,
    status character varying(32) NOT NULL,
    payload jsonb NOT NULL,
    result jsonb,
    idempotency_key character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: metric_snapshot_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metric_snapshot_runs (
    id text NOT NULL,
    tenant_id text NOT NULL,
    snapshot_date date NOT NULL,
    as_of timestamp with time zone NOT NULL,
    status text NOT NULL,
    attempt_count integer DEFAULT 1 NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_metric_snapshot_run_status CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text])))
);


--
-- Name: metric_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metric_snapshots (
    id text NOT NULL,
    tenant_id text NOT NULL,
    snapshot_date date NOT NULL,
    as_of timestamp with time zone NOT NULL,
    metric_key text NOT NULL,
    metric_version integer NOT NULL,
    dimension_key text NOT NULL,
    dimensions jsonb DEFAULT '{}'::jsonb NOT NULL,
    value numeric NOT NULL,
    sample_count integer DEFAULT 0 NOT NULL,
    generated_at timestamp with time zone NOT NULL
);


--
-- Name: monitor_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monitor_targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    service_endpoint_id uuid,
    certificate_binding_id uuid,
    target_url character varying(512),
    sni character varying(255),
    check_type character varying(32) NOT NULL,
    interval_seconds integer NOT NULL,
    status character varying(32) DEFAULT 'ACTIVE'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT ck_monitor_targets_anchor CHECK (((service_endpoint_id IS NOT NULL) OR (certificate_binding_id IS NOT NULL) OR (target_url IS NOT NULL))),
    CONSTRAINT monitor_targets_check_type_check CHECK (((check_type)::text = ANY ((ARRAY['HTTPS'::character varying, 'TCP_TLS'::character varying, 'LOCAL'::character varying, 'STORE'::character varying, 'CUSTOM'::character varying])::text[]))),
    CONSTRAINT monitor_targets_interval_seconds_check CHECK ((interval_seconds > 0)),
    CONSTRAINT monitor_targets_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'PAUSED'::character varying, 'FAILED'::character varying])::text[]))),
    CONSTRAINT monitor_targets_version_check CHECK ((version > 0))
);


--
-- Name: notification_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_channels (
    id text NOT NULL,
    tenant_id text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    status text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    secret_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    health_status text DEFAULT 'unknown'::text NOT NULL,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    last_succeeded_at timestamp with time zone,
    last_failed_at timestamp with time zone,
    last_latency_ms integer,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT notification_channels_health_status_check CHECK ((health_status = ANY (ARRAY['unknown'::text, 'healthy'::text, 'degraded'::text, 'unavailable'::text]))),
    CONSTRAINT notification_channels_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'deleted'::text]))),
    CONSTRAINT notification_channels_type_check CHECK ((type = ANY (ARRAY['email'::text, 'wecom'::text, 'slack'::text, 'webhook'::text])))
);


--
-- Name: notification_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_deliveries (
    id text NOT NULL,
    tenant_id text NOT NULL,
    request_id text NOT NULL,
    channel_id text NOT NULL,
    channel_name_snapshot text NOT NULL,
    channel_type text NOT NULL,
    target_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    rendered_title text,
    rendered_body text,
    status text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    next_attempt_at timestamp with time zone,
    lease_owner text,
    lease_until timestamp with time zone,
    failure_category text,
    failure_message text,
    response_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    external_id text,
    latency_ms integer,
    delivered_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT notification_deliveries_failure_category_check CHECK (((failure_category IS NULL) OR (failure_category = ANY (ARRAY['configuration'::text, 'authentication'::text, 'rate_limit'::text, 'network'::text, 'timeout'::text, 'rejected'::text, 'template'::text, 'security'::text, 'unknown'::text])))),
    CONSTRAINT notification_deliveries_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sending'::text, 'retrying'::text, 'delivered'::text, 'failed'::text, 'suppressed'::text])))
);


--
-- Name: notification_delivery_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_delivery_attempts (
    id text NOT NULL,
    tenant_id text NOT NULL,
    delivery_id text NOT NULL,
    attempt_no integer NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    success boolean,
    retryable boolean,
    failure_category text,
    failure_message text,
    status_code integer,
    latency_ms integer,
    response_summary jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: notification_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_requests (
    id text NOT NULL,
    tenant_id text NOT NULL,
    source text NOT NULL,
    event_key text NOT NULL,
    idempotency_key text NOT NULL,
    template_key text NOT NULL,
    route_id text,
    channel_id text,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text NOT NULL,
    status_reason text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT notification_requests_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'partially_delivered'::text, 'delivered'::text, 'failed'::text, 'suppressed'::text])))
);


--
-- Name: notification_routes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_routes (
    id text NOT NULL,
    tenant_id text NOT NULL,
    name text NOT NULL,
    status text NOT NULL,
    priority integer NOT NULL,
    matcher jsonb DEFAULT '{}'::jsonb NOT NULL,
    channel_targets jsonb DEFAULT '[]'::jsonb NOT NULL,
    stop_on_match boolean DEFAULT false NOT NULL,
    dedupe_window_seconds integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT notification_routes_dedupe_window_seconds_check CHECK ((dedupe_window_seconds >= 0)),
    CONSTRAINT notification_routes_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'deleted'::text])))
);


--
-- Name: notification_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_settings (
    tenant_id text NOT NULL,
    private_origins jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_by text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: notification_silences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_silences (
    id text NOT NULL,
    tenant_id text NOT NULL,
    name text NOT NULL,
    status text NOT NULL,
    matcher jsonb DEFAULT '{}'::jsonb NOT NULL,
    reason text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT notification_silences_check CHECK ((ends_at > starts_at)),
    CONSTRAINT notification_silences_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'deleted'::text])))
);


--
-- Name: notification_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_templates (
    id text NOT NULL,
    tenant_id text NOT NULL,
    template_key text NOT NULL,
    locale text NOT NULL,
    title_template text NOT NULL,
    body_template text NOT NULL,
    required_variables jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT notification_templates_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
);


--
-- Name: object_permission_access_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.object_permission_access_grants (
    id text NOT NULL,
    role_id text NOT NULL,
    object_set_id text NOT NULL,
    access_level text NOT NULL,
    effect text NOT NULL,
    constraints jsonb,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: object_permission_group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.object_permission_group_members (
    id text NOT NULL,
    group_id text NOT NULL,
    user_id text NOT NULL,
    source text NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: object_permission_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.object_permission_groups (
    id text NOT NULL,
    tenant_id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    source text NOT NULL,
    external_ref text,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    external_source_id text
);


--
-- Name: object_permission_object_set_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.object_permission_object_set_members (
    id text NOT NULL,
    object_set_id text NOT NULL,
    object_type text NOT NULL,
    object_id text NOT NULL,
    added_by text NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: object_permission_object_sets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.object_permission_object_sets (
    id text NOT NULL,
    tenant_id text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    object_types jsonb NOT NULL,
    conditions jsonb,
    status text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: object_permission_object_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.object_permission_object_types (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    table_name text NOT NULL,
    tenant_field text NOT NULL,
    owner_fields jsonb,
    parent_types jsonb,
    supported_actions jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: object_permission_role_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.object_permission_role_bindings (
    id text NOT NULL,
    tenant_id text NOT NULL,
    principal_type text NOT NULL,
    principal_id text NOT NULL,
    role_id text NOT NULL,
    object_set_id text NOT NULL,
    effect text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    valid_from timestamp with time zone,
    valid_to timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_acme_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_acme_accounts (
    id text NOT NULL,
    tenant_id text NOT NULL,
    provider_id text NOT NULL,
    directory_url_hash character(64) NOT NULL,
    account_url text,
    account_key_secret_ref text NOT NULL,
    contact jsonb DEFAULT '[]'::jsonb NOT NULL,
    eab_key_id_secret_ref text,
    eab_hmac_secret_ref text,
    status text NOT NULL,
    last_error_code text,
    last_error_message text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    eab_secret_ref text
);


--
-- Name: pg_acme_authorizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_acme_authorizations (
    id text NOT NULL,
    tenant_id text NOT NULL,
    order_id text NOT NULL,
    external_authorization_url text NOT NULL,
    identifier jsonb NOT NULL,
    status text NOT NULL,
    expires_at timestamp with time zone,
    wildcard boolean DEFAULT false NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_acme_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_acme_challenges (
    id text NOT NULL,
    tenant_id text NOT NULL,
    order_id text NOT NULL,
    authorization_id text NOT NULL,
    external_challenge_url text NOT NULL,
    type text NOT NULL,
    identifier text NOT NULL,
    token_sha256 character(64) NOT NULL,
    key_authorization_sha256 character(64) NOT NULL,
    presentation_id text,
    status text NOT NULL,
    lease_owner text,
    lease_expires_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    retry_after_at timestamp with time zone,
    failure_code text,
    failure_summary text,
    cleanup_error text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_acme_http01_presentations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_acme_http01_presentations (
    token_sha256 character(64) NOT NULL,
    tenant_id text NOT NULL,
    identifier text NOT NULL,
    key_authorization text NOT NULL,
    presentation_id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_acme_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_acme_orders (
    id text NOT NULL,
    tenant_id text NOT NULL,
    provider_id text NOT NULL,
    account_id text NOT NULL,
    certificate_request_id text NOT NULL,
    external_order_url text NOT NULL,
    status text NOT NULL,
    identifiers jsonb DEFAULT '[]'::jsonb NOT NULL,
    authorization_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    finalize_url text,
    certificate_url text,
    csr_sha256 character(64),
    retry_after_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    failure_code text,
    failure_summary text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_acme_plugin_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_acme_plugin_accounts (
    id text NOT NULL,
    tenant_id text NOT NULL,
    directory_url text NOT NULL,
    email text NOT NULL,
    account_url text,
    account_key_secret_ref text NOT NULL,
    status text NOT NULL,
    last_error_code text,
    last_error_message text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_acme_plugin_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_acme_plugin_challenges (
    id text NOT NULL,
    tenant_id text NOT NULL,
    request_id text NOT NULL,
    authorization_url text,
    challenge_url text NOT NULL,
    type text NOT NULL,
    identifier text NOT NULL,
    token text,
    status text NOT NULL,
    retry_after_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_error_code text,
    last_error_message text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_acme_plugin_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_acme_plugin_operations (
    id text NOT NULL,
    tenant_id text NOT NULL,
    request_id text NOT NULL,
    operation text NOT NULL,
    idempotency_key text NOT NULL,
    status text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_retry_at timestamp with time zone,
    may_be_unknown boolean DEFAULT false NOT NULL,
    last_error_code text,
    last_error_message text,
    checkpoint jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_acme_plugin_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_acme_plugin_requests (
    id text NOT NULL,
    tenant_id text NOT NULL,
    certificate_asset_id text,
    account_id text NOT NULL,
    plugin_version_id text NOT NULL,
    capability_key text NOT NULL,
    workflow_key text NOT NULL,
    workflow_version_id text NOT NULL,
    directory_url text NOT NULL,
    identifiers jsonb DEFAULT '[]'::jsonb NOT NULL,
    challenge_type text NOT NULL,
    csr_pem text NOT NULL,
    csr_sha256 character(64) NOT NULL,
    requested_public_key_fingerprint_sha256 text,
    status text NOT NULL,
    order_url text,
    certificate_url text,
    certificate_version_id text,
    retry_after_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_action text,
    last_error_code text,
    last_error_message text,
    unknown_reason text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_acme_renewal_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_acme_renewal_policies (
    id text NOT NULL,
    tenant_id text NOT NULL,
    certificate_asset_id text,
    binding_id text,
    provider_id text NOT NULL,
    account_id text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    renewal_window_days integer NOT NULL,
    challenge_type text NOT NULL,
    rotate_key_on_renewal boolean DEFAULT true NOT NULL,
    deployment_mode text NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    backoff_seconds integer DEFAULT 300 NOT NULL,
    maintenance_window jsonb,
    status text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_agent_capability_snapshot_current; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_agent_capability_snapshot_current (
    tenant_id text NOT NULL,
    agent_id text NOT NULL,
    latest_snapshot_id text NOT NULL,
    latest_reported_at timestamp with time zone NOT NULL,
    latest_full_web_snapshot_id text,
    latest_full_web_reported_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pg_agent_snapshot_current_full_web_pair_check CHECK (((latest_full_web_snapshot_id IS NULL) = (latest_full_web_reported_at IS NULL)))
);


--
-- Name: pg_agent_snapshot_retention_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_agent_snapshot_retention_runs (
    run_id text NOT NULL,
    policy_version text NOT NULL,
    mode text NOT NULL,
    status text NOT NULL,
    regular_retention_days integer NOT NULL,
    full_web_retention_days integer NOT NULL,
    regular_cutoff_at timestamp with time zone NOT NULL,
    full_web_cutoff_at timestamp with time zone NOT NULL,
    candidate_count integer DEFAULT 0 NOT NULL,
    candidate_bytes bigint DEFAULT 0 NOT NULL,
    protected_current_count integer DEFAULT 0 NOT NULL,
    protected_audit_count integer DEFAULT 0 NOT NULL,
    invalid_count integer DEFAULT 0 NOT NULL,
    skipped_count integer DEFAULT 0 NOT NULL,
    deleted_count integer DEFAULT 0 NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pg_agent_snapshot_retention_runs_candidate_bytes_check CHECK ((candidate_bytes >= 0)),
    CONSTRAINT pg_agent_snapshot_retention_runs_candidate_count_check CHECK ((candidate_count >= 0)),
    CONSTRAINT pg_agent_snapshot_retention_runs_deleted_count_check CHECK ((deleted_count >= 0)),
    CONSTRAINT pg_agent_snapshot_retention_runs_full_web_retention_days_check CHECK ((full_web_retention_days > 0)),
    CONSTRAINT pg_agent_snapshot_retention_runs_invalid_count_check CHECK ((invalid_count >= 0)),
    CONSTRAINT pg_agent_snapshot_retention_runs_mode_check CHECK ((mode = ANY (ARRAY['DRY_RUN'::text, 'EXECUTE'::text]))),
    CONSTRAINT pg_agent_snapshot_retention_runs_protected_audit_count_check CHECK ((protected_audit_count >= 0)),
    CONSTRAINT pg_agent_snapshot_retention_runs_protected_current_count_check CHECK ((protected_current_count >= 0)),
    CONSTRAINT pg_agent_snapshot_retention_runs_regular_retention_days_check CHECK ((regular_retention_days > 0)),
    CONSTRAINT pg_agent_snapshot_retention_runs_skipped_count_check CHECK ((skipped_count >= 0)),
    CONSTRAINT pg_agent_snapshot_retention_runs_status_check CHECK ((status = ANY (ARRAY['DRY_RUN'::text, 'RUNNING'::text, 'COMPLETED'::text, 'FAILED'::text])))
);


--
-- Name: pg_application_asset_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_application_asset_targets (
    id text NOT NULL,
    tenant_id text NOT NULL,
    application_asset_id text NOT NULL,
    managed_target_id text NOT NULL,
    status character varying(32) NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: pg_asset_conflicts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_asset_conflicts (
    id text NOT NULL,
    tenant_id text NOT NULL,
    resource_type character varying(32) NOT NULL,
    resource_id text NOT NULL,
    field character varying(128) NOT NULL,
    current_value jsonb,
    discovered_value jsonb,
    source_snapshot_id text NOT NULL,
    status character varying(32) NOT NULL,
    resolved_by text,
    resolved_at timestamp with time zone,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: pg_business_permission_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_business_permission_grants (
    id character varying(128) NOT NULL,
    tenant_id character varying(128) NOT NULL,
    principal_type character varying(32) NOT NULL,
    principal_id character varying(128) NOT NULL,
    role_id character varying(128) NOT NULL,
    domain character varying(32) NOT NULL,
    level character varying(32) NOT NULL,
    root_object_type character varying(128) NOT NULL,
    root_object_id character varying(128),
    root_scope jsonb,
    effect character varying(16) DEFAULT 'allow'::character varying NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    resolver_version character varying(64) NOT NULL,
    related_resource_version character varying(128) NOT NULL,
    expanded_resource_types jsonb DEFAULT '[]'::jsonb NOT NULL,
    expanded_actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by character varying(128) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT ck_business_permission_domain CHECK (((domain)::text = ANY ((ARRAY['certificate'::character varying, 'application'::character varying, 'audit'::character varying, 'settings'::character varying])::text[]))),
    CONSTRAINT ck_business_permission_effect CHECK (((effect)::text = ANY ((ARRAY['allow'::character varying, 'deny'::character varying])::text[]))),
    CONSTRAINT ck_business_permission_level CHECK (((level)::text = ANY ((ARRAY['user'::character varying, 'manager'::character varying])::text[]))),
    CONSTRAINT ck_business_permission_principal CHECK (((principal_type)::text = ANY ((ARRAY['user'::character varying, 'group'::character varying, 'external_group'::character varying])::text[]))),
    CONSTRAINT ck_business_permission_status CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'revoked'::character varying])::text[]))),
    CONSTRAINT ck_business_permission_tenant CHECK (((tenant_id)::text <> '*'::text))
);


--
-- Name: pg_business_permission_relations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_business_permission_relations (
    id character varying(512) NOT NULL,
    tenant_id character varying(128) NOT NULL,
    root_domain character varying(32) NOT NULL,
    root_object_type character varying(128) NOT NULL,
    root_object_id character varying(128) NOT NULL,
    related_object_type character varying(128) NOT NULL,
    related_object_id character varying(128) NOT NULL,
    relation character varying(128) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_business_permission_relation_domain CHECK (((root_domain)::text = ANY ((ARRAY['certificate'::character varying, 'application'::character varying, 'audit'::character varying, 'settings'::character varying])::text[]))),
    CONSTRAINT ck_business_permission_relation_tenant CHECK (((tenant_id)::text <> '*'::text))
);


--
-- Name: pg_ca_capability_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_ca_capability_records (
    id text NOT NULL,
    tenant_id text NOT NULL,
    owner_type text NOT NULL,
    owner_id text NOT NULL,
    capability_key text NOT NULL,
    state text NOT NULL,
    source text NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    verified_at timestamp with time zone,
    expires_at timestamp with time zone,
    failure_reason text,
    payload jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT pg_ca_capability_records_owner_type_check CHECK ((owner_type = ANY (ARRAY['provider'::text, 'node'::text]))),
    CONSTRAINT pg_ca_capability_records_state_check CHECK ((state = ANY (ARRAY['declared'::text, 'discovered'::text, 'verified'::text, 'unavailable'::text])))
);


--
-- Name: pg_ca_external_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_ca_external_observations (
    id text NOT NULL,
    tenant_id text NOT NULL,
    provider_id text NOT NULL,
    ca_id text NOT NULL,
    object_type text NOT NULL,
    external_object_id text NOT NULL,
    external_parent_id text,
    normalized_status text NOT NULL,
    source_status text,
    source_revision text,
    subject_common_name text,
    serial_number text,
    template_external_id text,
    requested_by_display text,
    submitted_at timestamp with time zone,
    issued_at timestamp with time zone,
    revoked_at timestamp with time zone,
    not_before timestamp with time zone,
    not_after timestamp with time zone,
    raw_summary jsonb NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    first_observed_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT pg_ca_external_observations_normalized_status_check CHECK ((normalized_status = ANY (ARRAY['pending'::text, 'issued'::text, 'rejected'::text, 'revoked'::text, 'failed'::text, 'unknown'::text]))),
    CONSTRAINT pg_ca_external_observations_object_type_check CHECK ((object_type = ANY (ARRAY['request'::text, 'issuance'::text, 'revocation'::text, 'template'::text])))
);


--
-- Name: pg_ca_issuance_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_ca_issuance_records (
    id text NOT NULL,
    tenant_id text NOT NULL,
    ca_id text NOT NULL,
    serial_number text NOT NULL,
    certificate_request_id text,
    certificate_version_id text,
    application_asset_id text,
    status text NOT NULL,
    record_origin text NOT NULL,
    subject_common_name text,
    sans jsonb DEFAULT '[]'::jsonb NOT NULL,
    certificate_fingerprint_sha256 text,
    public_key_fingerprint_sha256 text,
    not_before timestamp with time zone,
    not_after timestamp with time zone,
    issued_at timestamp with time zone,
    observed_at timestamp with time zone NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    revocation_reason text,
    revoked_at timestamp with time zone,
    invalidity_date timestamp with time zone,
    CONSTRAINT pg_ca_issuance_records_record_origin_check CHECK ((record_origin = ANY (ARRAY['native'::text, 'historical_backfill'::text, 'external'::text]))),
    CONSTRAINT pg_ca_issuance_records_status_check CHECK ((status = ANY (ARRAY['reserved'::text, 'issued'::text, 'revoked'::text, 'expired'::text, 'failed'::text])))
);


--
-- Name: pg_ca_node_enrollment_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_ca_node_enrollment_tokens (
    id text NOT NULL,
    tenant_id text NOT NULL,
    provider_id text NOT NULL,
    token_hash text NOT NULL,
    status text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone
);


--
-- Name: pg_ca_node_request_nonces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_ca_node_request_nonces (
    node_id text NOT NULL,
    nonce text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: pg_ca_node_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_ca_node_tasks (
    id text NOT NULL,
    tenant_id text NOT NULL,
    provider_id text NOT NULL,
    node_id text,
    task_type text NOT NULL,
    idempotency_key text NOT NULL,
    payload jsonb NOT NULL,
    status text NOT NULL,
    lease_expires_at timestamp with time zone,
    result jsonb,
    error_code text,
    error_message text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_ca_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_ca_nodes (
    id text NOT NULL,
    tenant_id text NOT NULL,
    provider_id text NOT NULL,
    name text NOT NULL,
    platform text NOT NULL,
    role text NOT NULL,
    identity_fingerprint text NOT NULL,
    key_backend text NOT NULL,
    exportability text NOT NULL,
    capabilities jsonb DEFAULT '{}'::jsonb NOT NULL,
    health_status text NOT NULL,
    last_heartbeat_at timestamp with time zone,
    lease_expires_at timestamp with time zone,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_ca_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_ca_providers (
    id text NOT NULL,
    tenant_id text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    deployment_mode text NOT NULL,
    runtime_platform text NOT NULL,
    availability_mode text NOT NULL,
    endpoint text,
    credential_secret_ref text,
    capabilities jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_ca_serial_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_ca_serial_states (
    tenant_id text NOT NULL,
    ca_id text NOT NULL,
    next_serial numeric(39,0) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT pg_ca_serial_states_next_serial_check CHECK ((next_serial > (0)::numeric))
);


--
-- Name: pg_ca_sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_ca_sync_runs (
    id text NOT NULL,
    tenant_id text NOT NULL,
    provider_id text NOT NULL,
    ca_id text NOT NULL,
    object_type text NOT NULL,
    mode text NOT NULL,
    status text NOT NULL,
    cursor_before text,
    cursor_after text,
    source_watermark text,
    read_count integer DEFAULT 0 NOT NULL,
    upserted_count integer DEFAULT 0 NOT NULL,
    skipped_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    error_code text,
    error_message text,
    lease_owner text,
    lease_expires_at timestamp with time zone,
    requested_by text NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone,
    changed_after timestamp with time zone,
    CONSTRAINT pg_ca_sync_runs_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT pg_ca_sync_runs_failed_count_check CHECK ((failed_count >= 0)),
    CONSTRAINT pg_ca_sync_runs_mode_check CHECK ((mode = ANY (ARRAY['incremental'::text, 'full'::text]))),
    CONSTRAINT pg_ca_sync_runs_object_type_check CHECK ((object_type = ANY (ARRAY['request'::text, 'issuance'::text, 'revocation'::text, 'template'::text]))),
    CONSTRAINT pg_ca_sync_runs_read_count_check CHECK ((read_count >= 0)),
    CONSTRAINT pg_ca_sync_runs_skipped_count_check CHECK ((skipped_count >= 0)),
    CONSTRAINT pg_ca_sync_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'partial'::text, 'failed'::text, 'cancelled'::text]))),
    CONSTRAINT pg_ca_sync_runs_upserted_count_check CHECK ((upserted_count >= 0))
);


--
-- Name: pg_ca_template_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_ca_template_mappings (
    id text NOT NULL,
    tenant_id text NOT NULL,
    provider_id text NOT NULL,
    ca_id text NOT NULL,
    profile_version_id text NOT NULL,
    external_template_id text NOT NULL,
    status text NOT NULL,
    validation_summary jsonb NOT NULL,
    version integer NOT NULL,
    created_by text NOT NULL,
    updated_by text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT pg_ca_template_mappings_status_check CHECK ((status = ANY (ARRAY['active'::text, 'stale'::text, 'invalid'::text, 'disabled'::text]))),
    CONSTRAINT pg_ca_template_mappings_version_check CHECK ((version > 0))
);


--
-- Name: pg_ca_trust_domains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_ca_trust_domains (
    id text NOT NULL,
    tenant_id text NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    purpose text NOT NULL,
    status text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    isolation_level text DEFAULT 'standard'::text NOT NULL,
    root_policy jsonb DEFAULT '{}'::jsonb NOT NULL,
    trust_policy jsonb DEFAULT '{}'::jsonb NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_certificate_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_certificate_artifacts (
    artifact_ref text NOT NULL,
    content bytea NOT NULL,
    content_type text NOT NULL,
    sha256 character(64) NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    tenant_id text DEFAULT 'dd43c28b-7411-4a45-9497-5547e2f1c8b8'::text NOT NULL
);


--
-- Name: pg_certificate_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_certificate_assets (
    id text NOT NULL,
    name character varying(256) NOT NULL,
    primary_domain character varying(255) NOT NULL,
    sans jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_type character varying(32) NOT NULL,
    current_version_id text,
    status character varying(32) NOT NULL,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id text DEFAULT 'dd43c28b-7411-4a45-9497-5547e2f1c8b8'::text NOT NULL
);


--
-- Name: pg_certificate_authorities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_certificate_authorities (
    id text NOT NULL,
    tenant_id text NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    parent_ca_id text,
    topology_mode text NOT NULL,
    provider_id text NOT NULL,
    key_reference_id text,
    certificate_version_id text,
    security_domain text NOT NULL,
    status text NOT NULL,
    path_length_constraint integer,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    trust_domain_id text,
    CONSTRAINT pg_certificate_authorities_check CHECK ((((role = 'root'::text) AND (parent_ca_id IS NULL)) OR ((role = 'intermediate'::text) AND (parent_ca_id IS NOT NULL))))
);


--
-- Name: pg_certificate_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_certificate_bindings (
    id text NOT NULL,
    tenant_id text NOT NULL,
    service_instance_id text NOT NULL,
    service_endpoint_id text,
    host_id text NOT NULL,
    domain_name character varying(255),
    domain character varying(255),
    port integer,
    protocol character varying(32),
    binding_key character varying(512) NOT NULL,
    binding_type character varying(32) NOT NULL,
    certificate_version_id text,
    target_certificate_version_id text,
    local_certificate_version_id text,
    observed_fingerprint_sha256 character(64),
    desired_fingerprint_sha256 character(64),
    target_fingerprint_sha256 character(64),
    unmanaged_certificate_fingerprint character(64),
    cert_path text,
    key_path text,
    chain_path text,
    keystore_path text,
    keystore_type character varying(32),
    store_location character varying(64),
    store_name character varying(64),
    store_thumbprint character varying(128),
    reload_command text,
    reload_hint jsonb,
    discovery_source character varying(32),
    verify_method character varying(32) NOT NULL,
    local_config_fingerprint character(64),
    local_config_path text,
    remote_endpoint_fingerprint character(64),
    remote_status character varying(32),
    tls_version character varying(64),
    chain_summary jsonb,
    checked_at timestamp with time zone,
    drift_status character varying(32),
    last_verified_at timestamp with time zone,
    last_deployed_at timestamp with time zone,
    status character varying(32) NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    service_asset_id text,
    site_asset_id text,
    managed_target_id text
);


--
-- Name: pg_certificate_issuances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_certificate_issuances (
    id text NOT NULL,
    tenant_id text NOT NULL,
    certificate_request_id text NOT NULL,
    provider_id text NOT NULL,
    provider_request_id text,
    serial_number text,
    status text NOT NULL,
    result_fingerprint_sha256 text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_certificate_profile_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_certificate_profile_versions (
    id text NOT NULL,
    profile_id text NOT NULL,
    version_no integer NOT NULL,
    rules jsonb NOT NULL,
    created_by text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_certificate_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_certificate_profiles (
    id text NOT NULL,
    tenant_id text NOT NULL,
    name text NOT NULL,
    security_domain text NOT NULL,
    status text NOT NULL,
    current_version integer NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    trust_domain_id text
);


--
-- Name: pg_certificate_renewal_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_certificate_renewal_jobs (
    id text NOT NULL,
    tenant_id text NOT NULL,
    certificate_version_id text,
    renewal_window_key text NOT NULL,
    status text NOT NULL,
    certificate_request_id text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    policy_id text,
    source_certificate_version_id text,
    acme_order_id text,
    deployment_plan_id text,
    execution_run_id text,
    promotion_status text DEFAULT 'pending'::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone,
    lease_owner text,
    lease_expires_at timestamp with time zone,
    failure_code text,
    failure_message text,
    policy_snapshot jsonb
);


--
-- Name: pg_certificate_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_certificate_requests (
    id text NOT NULL,
    tenant_id text NOT NULL,
    application_asset_id text NOT NULL,
    ca_id text NOT NULL,
    profile_version_id text NOT NULL,
    key_reference_id text NOT NULL,
    csr_pem text NOT NULL,
    csr_sha256 text NOT NULL,
    public_key_fingerprint_sha256 text NOT NULL,
    idempotency_key text NOT NULL,
    status text NOT NULL,
    requested_by text NOT NULL,
    approved_by text,
    provider_request_id text,
    certificate_version_id text,
    failure_code text,
    failure_message text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    trust_domain_id text
);


--
-- Name: pg_certificate_revocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_certificate_revocations (
    id text NOT NULL,
    tenant_id text NOT NULL,
    certificate_version_id text NOT NULL,
    ca_id text NOT NULL,
    reason text NOT NULL,
    status text NOT NULL,
    requested_by text NOT NULL,
    revoked_at timestamp with time zone,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    trust_domain_id text
);


--
-- Name: pg_certificate_version_formats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_certificate_version_formats (
    id text NOT NULL,
    certificate_version_id text,
    format character varying(32) NOT NULL,
    artifact_ref text NOT NULL,
    parameter_hash character(64) NOT NULL,
    contains_private_key boolean DEFAULT false NOT NULL,
    password_secret_ref text,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    tenant_id text DEFAULT 'dd43c28b-7411-4a45-9497-5547e2f1c8b8'::text NOT NULL
);


--
-- Name: pg_certificate_version_trust_roots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_certificate_version_trust_roots (
    id text NOT NULL,
    tenant_id text,
    certificate_version_id text NOT NULL,
    root_certificate_id text NOT NULL,
    relation character varying(32) NOT NULL,
    chain_path jsonb DEFAULT '[]'::jsonb NOT NULL,
    selection_reason text,
    resolution_status character varying(32) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pg_certificate_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_certificate_versions (
    id text NOT NULL,
    certificate_asset_id text NOT NULL,
    version_no integer NOT NULL,
    common_name character varying(255),
    sans jsonb DEFAULT '[]'::jsonb NOT NULL,
    issuer jsonb NOT NULL,
    subject jsonb NOT NULL,
    serial_number character varying(128) NOT NULL,
    not_before timestamp with time zone NOT NULL,
    not_after timestamp with time zone NOT NULL,
    fingerprint_sha256 character(64) NOT NULL,
    public_key_algorithm character varying(128) NOT NULL,
    signature_algorithm character varying(128) NOT NULL,
    leaf_storage_ref text NOT NULL,
    private_key_secret_ref text,
    chain_certificate_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    chain_order jsonb DEFAULT '[]'::jsonb NOT NULL,
    chain_diagnostics jsonb DEFAULT '[]'::jsonb NOT NULL,
    chain_status character varying(32) NOT NULL,
    deployable boolean DEFAULT false NOT NULL,
    source_type character varying(32) NOT NULL,
    status character varying(32) NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    public_key_fingerprint_sha256 text,
    issuing_ca_id text,
    certificate_request_id text,
    certificate_profile_version_id text,
    key_reference_id text,
    key_custody_mode text,
    trust_domain_id text,
    tenant_id text DEFAULT 'dd43c28b-7411-4a45-9497-5547e2f1c8b8'::text NOT NULL,
    activation_state text DEFAULT 'promoted'::text NOT NULL,
    CONSTRAINT ck_pg_certificate_versions_activation_state CHECK ((activation_state = ANY (ARRAY['staged'::text, 'promoted'::text])))
);


--
-- Name: pg_cloud_account_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_cloud_account_assets (
    id character varying(128) NOT NULL,
    tenant_id character varying(128) NOT NULL,
    asset_kind character varying(32) DEFAULT 'cloud.account'::character varying NOT NULL,
    provider_key character varying(128) NOT NULL,
    display_name character varying(255) NOT NULL,
    account_id character varying(255),
    credential_ref character varying(512) NOT NULL,
    scope jsonb DEFAULT '{}'::jsonb NOT NULL,
    identity_key character varying(512) NOT NULL,
    status character varying(32) DEFAULT 'ACTIVE'::character varying NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT ck_cloud_account_assets_credential_ref CHECK ((((credential_ref)::text ~~ 'secret://%'::text) OR ((credential_ref)::text ~~ 'credential://%'::text))),
    CONSTRAINT ck_cloud_account_assets_kind CHECK (((asset_kind)::text = 'cloud.account'::text)),
    CONSTRAINT pg_cloud_account_assets_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'DISABLED'::character varying, 'ERROR'::character varying, 'DELETED'::character varying])::text[]))),
    CONSTRAINT pg_cloud_account_assets_version_check CHECK ((version > 0))
);


--
-- Name: pg_data_correction_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_data_correction_batches (
    id character varying(128) NOT NULL,
    spec_id character varying(32) NOT NULL,
    operator_id character varying(128) NOT NULL,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    status character varying(32) NOT NULL,
    before_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    after_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    script_sha256 character varying(64) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT pg_data_correction_batches_spec_id_check CHECK (((spec_id)::text = '033.4'::text)),
    CONSTRAINT pg_data_correction_batches_status_check CHECK (((status)::text = ANY ((ARRAY['STARTED'::character varying, 'VERIFIED'::character varying, 'FAILED'::character varying])::text[])))
);


--
-- Name: pg_device_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_device_assets (
    service_asset_id text NOT NULL,
    tenant_id text NOT NULL,
    device_family character varying(64) NOT NULL,
    management_port integer DEFAULT 443 NOT NULL,
    credential_id text,
    auth_mode character varying(24) DEFAULT 'AUTO'::character varying NOT NULL,
    tls_verify boolean DEFAULT true NOT NULL,
    ca_secret_id text,
    gateway_id text,
    product_name text,
    software_version text,
    software_build text,
    runtime_mode text,
    ha_mode text,
    support_tier character varying(24) DEFAULT 'READ_ONLY'::character varying NOT NULL,
    capability_profile jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_discovered_at timestamp with time zone,
    last_error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    host_id text,
    plugin_version_id text,
    plugin_binding_id text,
    product_family text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT ck_pg_device_assets_auth_mode_nonempty CHECK ((length(TRIM(BOTH FROM auth_mode)) > 0)),
    CONSTRAINT ck_pg_device_assets_device_family_nonempty CHECK ((length(TRIM(BOTH FROM device_family)) > 0)),
    CONSTRAINT pg_device_assets_management_port_check CHECK (((management_port >= 1) AND (management_port <= 65535))),
    CONSTRAINT pg_device_assets_support_tier_check CHECK (((support_tier)::text = ANY ((ARRAY['SUPPORTED'::character varying, 'COMPATIBLE'::character varying, 'READ_ONLY'::character varying, 'UNSUPPORTED'::character varying])::text[]))),
    CONSTRAINT pg_device_assets_version_check CHECK ((version > 0))
);


--
-- Name: pg_device_certificate_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_device_certificate_bindings (
    id text NOT NULL,
    tenant_id text NOT NULL,
    device_asset_id text NOT NULL,
    virtual_server_id text NOT NULL,
    certificate_resource_id text NOT NULL,
    binding_key text NOT NULL,
    sni_certificate boolean DEFAULT false NOT NULL,
    priority integer,
    desired_certificate_version_id text,
    observed_fingerprint_sha256 character varying(64),
    desired_fingerprint_sha256 character varying(64),
    drift_state character varying(24) DEFAULT 'UNKNOWN'::character varying NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_verified_at timestamp with time zone,
    last_deployed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT pg_device_certificate_bindings_version_check CHECK ((version > 0))
);


--
-- Name: pg_device_certificate_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_device_certificate_resources (
    id text NOT NULL,
    tenant_id text NOT NULL,
    device_asset_id text NOT NULL,
    certkey_name text NOT NULL,
    certificate_path text,
    private_key_path text,
    subject text,
    issuer text,
    serial_number text,
    not_before timestamp with time zone,
    not_after timestamp with time zone,
    remote_status text,
    signature_algorithm text,
    public_key_algorithm text,
    public_key_size integer,
    linked_certkey_name text,
    fingerprint_sha256 character varying(64),
    source_version text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_discovered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT pg_device_certificate_resources_version_check CHECK ((version > 0))
);


--
-- Name: pg_device_liveness_scheduler_leases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_device_liveness_scheduler_leases (
    lease_key text NOT NULL,
    owner_id text NOT NULL,
    leased_until timestamp with time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pg_device_liveness_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_device_liveness_signals (
    id text NOT NULL,
    tenant_id text NOT NULL,
    resource_type character varying(16) NOT NULL,
    resource_id text NOT NULL,
    signal_type character varying(32) NOT NULL,
    required boolean DEFAULT true NOT NULL,
    status character varying(16) NOT NULL,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    last_observed_at timestamp with time zone,
    last_success_at timestamp with time zone,
    last_failure_at timestamp with time zone,
    endpoint_host text,
    endpoint_port integer,
    source character varying(24) NOT NULL,
    reason_code character varying(64),
    reason_detail text,
    observation_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pg_device_liveness_signals_consecutive_failures_check CHECK ((consecutive_failures >= 0)),
    CONSTRAINT pg_device_liveness_signals_endpoint_port_check CHECK (((endpoint_port IS NULL) OR ((endpoint_port >= 1) AND (endpoint_port <= 65535)))),
    CONSTRAINT pg_device_liveness_signals_resource_type_check CHECK (((resource_type)::text = ANY ((ARRAY['AGENT'::character varying, 'DEVICE'::character varying])::text[]))),
    CONSTRAINT pg_device_liveness_signals_signal_type_check CHECK (((signal_type)::text = ANY ((ARRAY['HEARTBEAT'::character varying, 'MANAGEMENT_TCP'::character varying])::text[]))),
    CONSTRAINT pg_device_liveness_signals_source_check CHECK (((source)::text = ANY ((ARRAY['AGENT'::character varying, 'CONTROL_PLANE'::character varying, 'GATEWAY'::character varying])::text[]))),
    CONSTRAINT pg_device_liveness_signals_status_check CHECK (((status)::text = ANY ((ARRAY['UNKNOWN'::character varying, 'HEALTHY'::character varying, 'SUSPECT'::character varying, 'FAILED'::character varying])::text[])))
);


--
-- Name: pg_device_virtual_servers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_device_virtual_servers (
    id text NOT NULL,
    tenant_id text NOT NULL,
    device_asset_id text NOT NULL,
    virtual_server_type character varying(16) NOT NULL,
    virtual_server_name text NOT NULL,
    target_key text NOT NULL,
    address text,
    port integer,
    protocol text,
    runtime_state text,
    sni_names jsonb DEFAULT '[]'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_discovered_at timestamp with time zone,
    status character varying(24) DEFAULT 'ACTIVE'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT ck_pg_device_virtual_servers_type_nonempty CHECK ((length(TRIM(BOTH FROM virtual_server_type)) > 0)),
    CONSTRAINT pg_device_virtual_servers_port_check CHECK (((port IS NULL) OR ((port >= 1) AND (port <= 65535)))),
    CONSTRAINT pg_device_virtual_servers_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'INACTIVE'::character varying, 'UNKNOWN'::character varying, 'STALE'::character varying, 'DELETED'::character varying])::text[]))),
    CONSTRAINT pg_device_virtual_servers_version_check CHECK ((version > 0))
);


--
-- Name: pg_discovery_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_discovery_snapshots (
    id text NOT NULL,
    tenant_id text NOT NULL,
    normalized_hash character varying(128) NOT NULL,
    source character varying(32) NOT NULL,
    normalized_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    raw_payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: pg_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_documents (
    namespace character varying(128) NOT NULL,
    document_id character varying(128) NOT NULL,
    payload jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pg_execution_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_execution_runs (
    id character varying(128) NOT NULL,
    tenant_id character varying(128),
    deployment_plan_id character varying(128) NOT NULL,
    execution_target_id character varying(128),
    run_no integer NOT NULL,
    type character varying(32) NOT NULL,
    idempotency_key character varying(128) NOT NULL,
    request_hash character varying(128) NOT NULL,
    external_run_id character varying(128),
    status character varying(32) NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    error_code character varying(128),
    error_message text,
    concurrency_limit integer,
    recovery_attempt_count integer,
    last_recovery_at timestamp with time zone,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    created_by character varying(128) NOT NULL,
    updated_by character varying(128),
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: pg_execution_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_execution_steps (
    id character varying(128) NOT NULL,
    tenant_id character varying(128),
    execution_run_id character varying(128) NOT NULL,
    deployment_plan_target_id character varying(128),
    step_no integer NOT NULL,
    step_type character varying(64) NOT NULL,
    name text NOT NULL,
    depends_on jsonb DEFAULT '[]'::jsonb NOT NULL,
    idempotent boolean,
    attempt_count integer NOT NULL,
    max_attempts integer NOT NULL,
    last_failure_category character varying(64),
    last_error_code character varying(128),
    last_error_message text,
    last_error_details jsonb,
    input_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(32) NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    created_by character varying(128),
    updated_by character varying(128),
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT pg_execution_steps_last_error_details_check CHECK (((last_error_details IS NULL) OR (jsonb_typeof(last_error_details) = 'object'::text)))
);


--
-- Name: pg_framework_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_framework_instances (
    id text NOT NULL,
    tenant_id text NOT NULL,
    device_id text,
    discovery_provider_key character varying(64) NOT NULL,
    service_name character varying(128),
    display_name character varying(255) NOT NULL,
    version_text character varying(128),
    install_path text,
    config_path text,
    runtime_user character varying(128),
    ports jsonb DEFAULT '[]'::jsonb NOT NULL,
    framework_key text,
    manual_overrides jsonb DEFAULT '{}'::jsonb NOT NULL,
    discovery_source character varying(32) NOT NULL,
    last_discovered_at timestamp with time zone,
    status character varying(32) NOT NULL,
    raw_facts jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    framework_type character varying(192) NOT NULL,
    asset_id text,
    CONSTRAINT ck_pg_framework_instances_asset_owner CHECK (((asset_id IS NOT NULL) OR (device_id IS NOT NULL))),
    CONSTRAINT ck_pg_framework_instances_type_namespace CHECK (((framework_type)::text ~ '^[a-z0-9]+([.-][a-z0-9]+)+$'::text))
);


--
-- Name: pg_gateway_credential_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_gateway_credential_sessions (
    id character varying(128) NOT NULL,
    tenant_id character varying(128) NOT NULL,
    task_id character varying(128) NOT NULL,
    secret_ref jsonb NOT NULL,
    grant_ref jsonb NOT NULL,
    gateway_id character varying(128) NOT NULL,
    target_id character varying(128) NOT NULL,
    protocol character varying(64) NOT NULL,
    allowed_actions jsonb NOT NULL,
    remaining_uses integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    status character varying(32) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: pg_gateway_reachability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_gateway_reachability (
    id character varying(128) NOT NULL,
    tenant_id character varying(128) NOT NULL,
    gateway_id character varying(128) NOT NULL,
    target_id character varying(128) NOT NULL,
    protocol character varying(64) NOT NULL,
    port integer,
    status character varying(32) NOT NULL,
    latency_ms integer,
    checked_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    entity_id character varying(128) NOT NULL
);


--
-- Name: pg_gateway_zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_gateway_zones (
    id character varying(128) NOT NULL,
    tenant_id character varying(128) NOT NULL,
    name text NOT NULL,
    zone_type character varying(64) NOT NULL,
    policy jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_gateways; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_gateways (
    id character varying(128) NOT NULL,
    tenant_id character varying(128) NOT NULL,
    agent_id character varying(128) NOT NULL,
    zone_ids jsonb NOT NULL,
    version character varying(64) NOT NULL,
    status character varying(32) NOT NULL,
    adapters jsonb NOT NULL,
    capabilities jsonb NOT NULL,
    capability_set_id character varying(128) NOT NULL,
    current_load integer DEFAULT 0 NOT NULL,
    max_concurrent_tasks integer DEFAULT 4 NOT NULL,
    success_rate numeric DEFAULT 1 NOT NULL,
    last_heartbeat_at timestamp with time zone,
    revoked_at timestamp with time zone,
    disabled_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_hosts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_hosts (
    id text NOT NULL,
    tenant_id text NOT NULL,
    hostname character varying(255),
    display_name character varying(255),
    primary_ip text,
    ip_addresses jsonb DEFAULT '[]'::jsonb NOT NULL,
    os_type character varying(32) NOT NULL,
    os_name character varying(128),
    os_version character varying(128),
    arch character varying(64),
    environment character varying(32),
    zone_id text,
    owner_id text,
    management_channels jsonb DEFAULT '[]'::jsonb NOT NULL,
    discovery_source character varying(32) NOT NULL,
    last_discovered_at timestamp with time zone,
    agent_id text,
    asset_fingerprint text,
    compatibility_level character varying(8) NOT NULL,
    management_mode character varying(32) NOT NULL,
    status character varying(32) NOT NULL,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: pg_key_references; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_key_references (
    id text NOT NULL,
    tenant_id text NOT NULL,
    owner_type text NOT NULL,
    owner_id text NOT NULL,
    custody_mode text NOT NULL,
    backend_type text NOT NULL,
    opaque_reference text,
    secret_ref text,
    public_key_fingerprint_sha256 text NOT NULL,
    exportability text NOT NULL,
    protection_level text NOT NULL,
    status text NOT NULL,
    rotated_from_key_id text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_managed_target_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_managed_target_snapshots (
    id text NOT NULL,
    tenant_id text NOT NULL,
    application_asset_id text,
    site_asset_id text,
    managed_target_id text,
    certificate_binding_id text,
    execution_run_id text,
    execution_step_id text,
    binding_information text,
    host_header text,
    port integer,
    store_location text,
    store_name text,
    store_thumbprint text,
    certificate_version_id text,
    fingerprint_sha256 text,
    snapshot_type text NOT NULL,
    status text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    captured_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: pg_managed_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_managed_targets (
    id text NOT NULL,
    tenant_id text NOT NULL,
    agent_id text,
    device_id text,
    framework_instance_id text,
    service_asset_id text,
    site_id text,
    discovery_provider_key character varying(64) NOT NULL,
    framework_type character varying(64),
    target_type character varying(32) NOT NULL,
    target_key text NOT NULL,
    binding_key text,
    capability_profile jsonb DEFAULT '{}'::jsonb NOT NULL,
    deployment_mode text,
    last_seen_at timestamp with time zone,
    status character varying(32) DEFAULT 'ACTIVE'::character varying NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    device_asset_id text,
    supported_capabilities jsonb NOT NULL,
    execution_locations jsonb NOT NULL,
    asset_id text,
    CONSTRAINT ck_pg_managed_targets_asset_owner CHECK (((asset_id IS NOT NULL) OR (device_id IS NOT NULL))),
    CONSTRAINT ck_pg_managed_targets_execution_locations_array CHECK (((jsonb_typeof(execution_locations) = 'array'::text) AND (jsonb_array_length(execution_locations) > 0))),
    CONSTRAINT ck_pg_managed_targets_supported_capabilities_array CHECK (((jsonb_typeof(supported_capabilities) = 'array'::text) AND (jsonb_array_length(supported_capabilities) > 0))),
    CONSTRAINT ck_pg_managed_targets_target_type_namespace CHECK (((target_type)::text ~ '^[a-z0-9]+([.-][a-z0-9]+)+$'::text)),
    CONSTRAINT pg_managed_targets_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'INACTIVE'::character varying, 'UNKNOWN'::character varying, 'STALE'::character varying, 'UNREACHABLE'::character varying, 'DISABLED'::character varying, 'DELETED'::character varying])::text[]))),
    CONSTRAINT pg_managed_targets_version_check CHECK ((version > 0))
);


--
-- Name: pg_monitor_alert_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_monitor_alert_rules (
    id text NOT NULL,
    tenant_id text,
    name text NOT NULL,
    threshold jsonb NOT NULL,
    scope jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text NOT NULL,
    silence jsonb,
    created_by text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_monitor_certificate_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_monitor_certificate_observations (
    id text NOT NULL,
    tenant_id text,
    service_asset_id text NOT NULL,
    source text NOT NULL,
    probe_url text NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    fingerprint_sha256 text NOT NULL,
    subject text,
    issuer text,
    serial_number text,
    not_before text,
    not_after text,
    dns_names jsonb DEFAULT '[]'::jsonb NOT NULL,
    verified boolean,
    verification_error text,
    raw_result jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: pg_monitor_certificate_observations_dedup_backup_20260707; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_monitor_certificate_observations_dedup_backup_20260707 (
    id text,
    tenant_id text,
    service_asset_id text,
    source text,
    probe_url text,
    observed_at timestamp with time zone,
    fingerprint_sha256 text,
    subject text,
    issuer text,
    serial_number text,
    not_before text,
    not_after text,
    dns_names jsonb,
    verified boolean,
    verification_error text,
    raw_result jsonb,
    created_at timestamp with time zone,
    backed_up_at timestamp with time zone,
    backup_reason text
);


--
-- Name: pg_monitor_probe_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_monitor_probe_results (
    id text NOT NULL,
    tenant_id text NOT NULL,
    monitor_target_id text,
    service_asset_id text NOT NULL,
    source text NOT NULL,
    probe_url text NOT NULL,
    status text NOT NULL,
    success boolean NOT NULL,
    latency_ms integer NOT NULL,
    checked_at timestamp with time zone NOT NULL,
    message text NOT NULL,
    http_status integer,
    certificate jsonb,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT pg_monitor_probe_results_status_check CHECK ((status = ANY (ARRAY['READY'::text, 'WARNING'::text, 'ERROR'::text])))
);


--
-- Name: pg_monitor_risk_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_monitor_risk_events (
    id text NOT NULL,
    tenant_id text,
    dedup_key text NOT NULL,
    risk_type text NOT NULL,
    source text NOT NULL,
    severity text NOT NULL,
    status text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    scope jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    first_detected_at timestamp with time zone NOT NULL,
    last_detected_at timestamp with time zone NOT NULL,
    resolved_at timestamp with time zone,
    occurrence_count integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: pg_monitor_scheduler_windows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_monitor_scheduler_windows (
    tenant_id text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    task_id text,
    candidate_count integer NOT NULL,
    target_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pg_monitor_scheduler_windows_candidate_count_check CHECK ((candidate_count >= 0)),
    CONSTRAINT pg_monitor_scheduler_windows_status_check CHECK ((status = ANY (ARRAY['CLAIMED'::text, 'ENQUEUED'::text, 'FAILED'::text]))),
    CONSTRAINT pg_monitor_scheduler_windows_target_ids_check CHECK ((jsonb_typeof(target_ids) = 'array'::text))
);


--
-- Name: pg_monitor_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_monitor_targets (
    id text NOT NULL,
    tenant_id text NOT NULL,
    service_asset_id text NOT NULL,
    metrics jsonb DEFAULT '[]'::jsonb NOT NULL,
    interval_seconds integer NOT NULL,
    status text NOT NULL,
    created_by text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    next_run_at timestamp with time zone NOT NULL,
    CONSTRAINT pg_monitor_targets_interval_seconds_check CHECK ((interval_seconds > 0)),
    CONSTRAINT pg_monitor_targets_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text])))
);


--
-- Name: pg_root_certificate_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_root_certificate_records (
    id text NOT NULL,
    fingerprint_sha256 character(64) NOT NULL,
    certificate_artifact_ref text NOT NULL,
    subject jsonb NOT NULL,
    issuer jsonb NOT NULL,
    serial_number character varying(256) NOT NULL,
    not_before timestamp with time zone NOT NULL,
    not_after timestamp with time zone NOT NULL,
    basic_constraints jsonb DEFAULT '{}'::jsonb NOT NULL,
    validation_status character varying(32) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pg_root_certificate_source_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_root_certificate_source_observations (
    id text NOT NULL,
    root_certificate_id text NOT NULL,
    source_type character varying(64) NOT NULL,
    source_ref text,
    observed_fingerprint character(64) NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    status character varying(32) NOT NULL,
    failure_code character varying(128)
);


--
-- Name: pg_service_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_service_assets (
    id text NOT NULL,
    tenant_id text NOT NULL,
    address character varying(255) NOT NULL,
    address_type character varying(16) NOT NULL,
    port integer NOT NULL,
    protocol character varying(16) NOT NULL,
    sni_name character varying(255),
    display_name character varying(255),
    service_instance_id text,
    service_endpoint_id text,
    host_id text,
    environment character varying(32),
    discovery_source character varying(32) NOT NULL,
    last_discovered_at timestamp with time zone,
    status character varying(32) NOT NULL,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    platform character varying(16),
    agent_id text,
    asset_kind character varying(16) DEFAULT 'APPLICATION'::character varying NOT NULL,
    CONSTRAINT ck_pg_service_assets_asset_kind CHECK (((asset_kind)::text = ANY ((ARRAY['APPLICATION'::character varying, 'DEVICE'::character varying])::text[])))
);


--
-- Name: pg_service_endpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_service_endpoints (
    id text NOT NULL,
    tenant_id text NOT NULL,
    service_instance_id text NOT NULL,
    host_id text NOT NULL,
    protocol character varying(16) NOT NULL,
    host_name character varying(255),
    listen_ip text,
    port integer NOT NULL,
    path_hint text,
    status character varying(32) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: pg_site_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_site_assets (
    id text NOT NULL,
    tenant_id text NOT NULL,
    framework_instance_id text NOT NULL,
    service_asset_id text,
    device_id text,
    agent_id text,
    discovery_provider_key character varying(64) NOT NULL,
    site_type character varying(32) NOT NULL,
    site_name text NOT NULL,
    site_key text NOT NULL,
    binding_information text,
    host_header text,
    listen_ip text,
    port integer,
    protocol character varying(16),
    config_path text,
    runtime_status text,
    discovery_source character varying(32) NOT NULL,
    last_discovered_at timestamp with time zone,
    status character varying(32) DEFAULT 'ACTIVE'::character varying NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    asset_id text,
    CONSTRAINT ck_pg_site_assets_asset_owner CHECK (((asset_id IS NOT NULL) OR (device_id IS NOT NULL))),
    CONSTRAINT ck_pg_site_assets_site_type_namespace CHECK (((site_type)::text ~ '^[a-z0-9]+([.-][a-z0-9]+)+$'::text)),
    CONSTRAINT pg_site_assets_discovery_source_check CHECK (((discovery_source)::text = ANY ((ARRAY['AGENT'::character varying, 'SSH'::character varying, 'MANUAL'::character varying, 'GATEWAY'::character varying, 'WINRM'::character varying, 'IMPORT'::character varying, 'PROVIDER'::character varying])::text[]))),
    CONSTRAINT pg_site_assets_port_check CHECK (((port IS NULL) OR ((port >= 1) AND (port <= 65535)))),
    CONSTRAINT pg_site_assets_protocol_check CHECK (((protocol IS NULL) OR ((protocol)::text = ANY ((ARRAY['HTTPS'::character varying, 'TLS'::character varying, 'STARTTLS'::character varying, 'HTTP'::character varying])::text[])))),
    CONSTRAINT pg_site_assets_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'INACTIVE'::character varying, 'UNKNOWN'::character varying, 'STALE'::character varying, 'DISABLED'::character varying, 'RETIRED'::character varying, 'DELETED'::character varying])::text[]))),
    CONSTRAINT pg_site_assets_version_check CHECK ((version > 0))
);


--
-- Name: pg_trust_distributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pg_trust_distributions (
    id text NOT NULL,
    tenant_id text NOT NULL,
    ca_id text NOT NULL,
    target_scope jsonb NOT NULL,
    status text NOT NULL,
    requested_by text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    trust_domain_id text
);


--
-- Name: plugin_capability_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plugin_capability_assignments (
    id character varying(128) NOT NULL,
    tenant_id character varying(128) NOT NULL,
    owner_type character varying(32) NOT NULL,
    owner_id character varying(128) NOT NULL,
    capability_key character varying(192) NOT NULL,
    plugin_version_id character varying(128) NOT NULL,
    plugin_binding_id character varying(128) NOT NULL,
    precedence character varying(32) NOT NULL,
    status character varying(32) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT plugin_capability_assignments_owner_type_check CHECK (((owner_type)::text = ANY ((ARRAY['DEVICE'::character varying, 'MANAGED_TARGET'::character varying, 'APPLICATION_ASSET'::character varying, 'CLOUD_ACCOUNT_ASSET'::character varying])::text[]))),
    CONSTRAINT plugin_capability_assignments_precedence_check CHECK (((precedence)::text = ANY ((ARRAY['DEVICE_DEFAULT'::character varying, 'TARGET_OVERRIDE'::character varying, 'ASSET_OVERRIDE'::character varying])::text[]))),
    CONSTRAINT plugin_capability_assignments_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'DISABLED'::character varying, 'MIGRATING'::character varying])::text[])))
);


--
-- Name: plugin_discovered_certificate_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plugin_discovered_certificate_bindings (
    id text NOT NULL,
    tenant_id text NOT NULL,
    device_asset_id text NOT NULL,
    stable_key text NOT NULL,
    site_asset_id text,
    discovered_certificate_id text NOT NULL,
    binding_name text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(16) DEFAULT 'ACTIVE'::character varying NOT NULL,
    last_discovered_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    current_certificate_version_id text,
    desired_certificate_version_id text,
    observed_fingerprint_sha256 character varying(64),
    desired_fingerprint_sha256 character varying(64),
    drift_state character varying(24) DEFAULT 'UNKNOWN'::character varying NOT NULL,
    last_verified_at timestamp with time zone,
    last_deployed_at timestamp with time zone,
    managed_target_id text,
    CONSTRAINT plugin_discovered_certificate_bindings_drift_state_check CHECK (((drift_state)::text = ANY ((ARRAY['SYNCED'::character varying, 'DRIFTED'::character varying, 'UNMANAGED'::character varying, 'INCOMPLETE'::character varying, 'UNKNOWN'::character varying])::text[]))),
    CONSTRAINT plugin_discovered_certificate_bindings_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'STALE'::character varying])::text[])))
);


--
-- Name: plugin_discovered_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plugin_discovered_certificates (
    id text NOT NULL,
    tenant_id text NOT NULL,
    device_asset_id text NOT NULL,
    stable_key text NOT NULL,
    fingerprint_sha256 character varying(64),
    subject text,
    issuer text,
    not_after timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(16) DEFAULT 'ACTIVE'::character varying NOT NULL,
    last_discovered_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    certificate_version_id text,
    not_before timestamp with time zone,
    CONSTRAINT plugin_discovered_certificates_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'STALE'::character varying])::text[])))
);


--
-- Name: plugin_discovery_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plugin_discovery_snapshots (
    id text NOT NULL,
    tenant_id text NOT NULL,
    device_asset_id text,
    plugin_version_id text,
    plugin_binding_id text,
    normalized_sha256 character varying(64) NOT NULL,
    status character varying(16) NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    payload jsonb,
    error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    device_id text NOT NULL,
    discovery_provider_key text NOT NULL,
    discovery_source character varying(16) NOT NULL,
    CONSTRAINT ck_plugin_discovery_snapshots_identity CHECK ((((discovery_source)::text = 'AGENT'::text) OR (((discovery_source)::text = 'PROVIDER'::text) AND (device_asset_id IS NOT NULL) AND (plugin_version_id IS NOT NULL)))),
    CONSTRAINT ck_plugin_discovery_snapshots_source CHECK (((discovery_source)::text = ANY ((ARRAY['AGENT'::character varying, 'PROVIDER'::character varying])::text[]))),
    CONSTRAINT plugin_discovery_snapshots_status_check CHECK (((status)::text = ANY ((ARRAY['SUCCEEDED'::character varying, 'FAILED'::character varying])::text[])))
);


--
-- Name: plugin_promotion_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plugin_promotion_records (
    id character varying(64) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    source_plugin_binding_id character varying(64) NOT NULL,
    target_plugin_binding_id character varying(64),
    device_asset_id character varying(64),
    application_asset_id character varying(64),
    status character varying(32) NOT NULL,
    preview_snapshot jsonb NOT NULL,
    created_resources jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_code character varying(128),
    error_message text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    revoked_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT plugin_promotion_records_status_check CHECK (((status)::text = ANY ((ARRAY['PREVIEWED'::character varying, 'CONFLICT'::character varying, 'RUNNING'::character varying, 'COMPLETED'::character varying, 'ERROR'::character varying, 'REVOKED'::character varying])::text[])))
);


--
-- Name: plugin_resource_locks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plugin_resource_locks (
    id text NOT NULL,
    tenant_id text NOT NULL,
    resource_key text NOT NULL,
    lock_mode character varying(8) NOT NULL,
    owner_run_id text NOT NULL,
    owner_step_id text NOT NULL,
    fencing_token bigint NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT plugin_resource_locks_lock_mode_check CHECK (((lock_mode)::text = ANY ((ARRAY['READ'::character varying, 'WRITE'::character varying])::text[])))
);


--
-- Name: plugin_runner_cutover_rejections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plugin_runner_cutover_rejections (
    plugin_version_id character varying(128) NOT NULL,
    tenant_id character varying(128) NOT NULL,
    canonical_plugin_id character varying(192),
    reason character varying(64) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: plugin_runner_version_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plugin_runner_version_bindings (
    plugin_version_id character varying(128) NOT NULL,
    canonical_plugin_id character varying(192) NOT NULL,
    execution_mode character varying(32) NOT NULL,
    package_sha256 character varying(80) NOT NULL,
    manifest_sha256 character varying(80) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    tenant_id character varying(128) NOT NULL,
    plugin_version character varying(64) NOT NULL,
    resource_sha256 jsonb DEFAULT '{}'::jsonb NOT NULL,
    protocol_version character varying(64) DEFAULT 'gcac.plugin-runner/v1'::character varying NOT NULL,
    CONSTRAINT ck_plugin_runner_version_bindings_canonical_id CHECK (((canonical_plugin_id)::text = ANY ((ARRAY['web.nginx'::character varying, 'web.apache'::character varying, 'web.iis'::character varying, 'app.tomcat'::character varying, 'app.java-keystore'::character varying, 'app.rabbitmq'::character varying, 'app.service-certificate-file'::character varying, 'device.citrix.netscaler-adc'::character varying, 'device.synology-dsm'::character varying, 'cloud.aliyun'::character varying, 'cloud.tencent'::character varying, 'cloud.huawei'::character varying, 'cloud.volcengine'::character varying, 'ca.openssl'::character varying, 'ca.acme'::character varying, 'ca.microsoft-adcs'::character varying, 'ca.acme-dns'::character varying])::text[]))),
    CONSTRAINT ck_plugin_runner_version_bindings_manifest_hash CHECK (((manifest_sha256)::text ~ '^sha256:[a-f0-9]{64}$'::text)),
    CONSTRAINT ck_plugin_runner_version_bindings_package_hash CHECK (((package_sha256)::text ~ '^sha256:[a-f0-9]{64}$'::text)),
    CONSTRAINT ck_plugin_runner_version_bindings_plugin_version CHECK (((plugin_version)::text ~ '^[0-9]+[.][0-9]+[.][0-9]+([-][0-9A-Za-z.-]+)?([+][0-9A-Za-z.-]+)?$'::text)),
    CONSTRAINT ck_plugin_runner_version_bindings_protocol CHECK ((((execution_mode)::text = 'isolated_process'::text) AND ((protocol_version)::text = 'gcac.plugin-runner/v1'::text))),
    CONSTRAINT ck_plugin_runner_version_bindings_resource_hashes CHECK ((jsonb_typeof(resource_sha256) = 'object'::text)),
    CONSTRAINT ck_plugin_runner_version_bindings_tenant CHECK ((length(TRIM(BOTH FROM tenant_id)) > 0)),
    CONSTRAINT plugin_runner_version_bindings_execution_mode_check CHECK (((execution_mode)::text = 'isolated_process'::text))
);


--
-- Name: plugin_workflow_checkpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plugin_workflow_checkpoints (
    id text NOT NULL,
    tenant_id text NOT NULL,
    ledger_id text NOT NULL,
    checkpoint_name text NOT NULL,
    workflow_step_name text NOT NULL,
    capture jsonb NOT NULL,
    capture_hash character varying(64) NOT NULL,
    required_for_rollback boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: plugin_workflow_ledgers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plugin_workflow_ledgers (
    id text NOT NULL,
    tenant_id text NOT NULL,
    execution_run_id text NOT NULL,
    execution_step_id text NOT NULL,
    deployment_plan_target_id text,
    plugin_version_id text NOT NULL,
    workflow_version_id text NOT NULL,
    capability_key text NOT NULL,
    target_hash character varying(64) NOT NULL,
    plan_hash character varying(64) NOT NULL,
    input_hash character varying(64) NOT NULL,
    status character varying(32) NOT NULL,
    recovery_classification character varying(32) DEFAULT 'RESUMABLE'::character varying NOT NULL,
    completed_step_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    compensation_step_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT plugin_workflow_ledgers_recovery_classification_check CHECK (((recovery_classification)::text = ANY ((ARRAY['RESUMABLE'::character varying, 'ROLLBACK_REQUIRED'::character varying, 'MANUAL_INTERVENTION'::character varying])::text[]))),
    CONSTRAINT plugin_workflow_ledgers_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'COMPLETED'::character varying, 'ROLLBACK_RUNNING'::character varying, 'ROLLED_BACK'::character varying, 'MANUAL_INTERVENTION'::character varying])::text[])))
);


--
-- Name: report_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_artifacts (
    id text NOT NULL,
    tenant_id text NOT NULL,
    storage_key text NOT NULL,
    file_name text NOT NULL,
    content_type text NOT NULL,
    byte_size bigint NOT NULL,
    checksum_sha256 text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: report_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_runs (
    id text NOT NULL,
    tenant_id text NOT NULL,
    report_type text NOT NULL,
    status text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    columns jsonb DEFAULT '[]'::jsonb NOT NULL,
    metric_versions jsonb DEFAULT '{}'::jsonb NOT NULL,
    sla_policy_version integer,
    time_zone text NOT NULL,
    data_as_of timestamp with time zone NOT NULL,
    artifact_id text,
    error_message text,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    CONSTRAINT ck_report_run_status CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'expired'::text]))),
    CONSTRAINT ck_report_run_type CHECK ((report_type = ANY (ARRAY['incident_window'::text, 'risk_response'::text, 'automation_effectiveness'::text])))
);


--
-- Name: risk_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    risk_type character varying(64) NOT NULL,
    severity character varying(16) NOT NULL,
    certificate_binding_id uuid,
    certificate_version_id uuid,
    status character varying(32) DEFAULT 'OPEN'::character varying NOT NULL,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT ck_risk_events_anchor CHECK (((certificate_binding_id IS NOT NULL) OR (certificate_version_id IS NOT NULL))),
    CONSTRAINT risk_events_risk_type_check CHECK (((risk_type)::text = ANY ((ARRAY['EXPIRING'::character varying, 'EXPIRED'::character varying, 'DRIFTED'::character varying, 'CHAIN_INVALID'::character varying, 'DEPLOY_FAILED'::character varying, 'AGENT_OFFLINE'::character varying])::text[]))),
    CONSTRAINT risk_events_severity_check CHECK (((severity)::text = ANY ((ARRAY['LOW'::character varying, 'MEDIUM'::character varying, 'HIGH'::character varying, 'CRITICAL'::character varying])::text[]))),
    CONSTRAINT risk_events_status_check CHECK (((status)::text = ANY ((ARRAY['OPEN'::character varying, 'ACKED'::character varying, 'RESOLVED'::character varying, 'IGNORED'::character varying])::text[]))),
    CONSTRAINT risk_events_version_check CHECK ((version > 0))
);


--
-- Name: risk_sla_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_sla_policies (
    id text NOT NULL,
    tenant_id text NOT NULL,
    version integer NOT NULL,
    severity text NOT NULL,
    acknowledgement_seconds integer NOT NULL,
    resolution_seconds integer NOT NULL,
    effective_from timestamp with time zone NOT NULL,
    effective_to timestamp with time zone,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_risk_sla_policy_ack_positive CHECK ((acknowledgement_seconds > 0)),
    CONSTRAINT ck_risk_sla_policy_resolution_positive CHECK ((resolution_seconds > 0)),
    CONSTRAINT ck_risk_sla_policy_severity CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT ck_risk_sla_policy_window CHECK (((effective_to IS NULL) OR (effective_to > effective_from)))
);


--
-- Name: risk_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_status_history (
    id text NOT NULL,
    tenant_id text NOT NULL,
    risk_event_id text NOT NULL,
    action text NOT NULL,
    from_status text,
    to_status text NOT NULL,
    reason text,
    actor_type text NOT NULL,
    actor_id text,
    occurred_at timestamp with time zone NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_risk_status_history_action CHECK ((action = ANY (ARRAY['created'::text, 'acknowledged'::text, 'suppressed'::text, 'ignored'::text, 'resolved'::text, 'reopened'::text])))
);


--
-- Name: rollback_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rollback_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    execution_run_id uuid NOT NULL,
    status character varying(32) DEFAULT 'AVAILABLE'::character varying NOT NULL,
    steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT rollback_plans_status_check CHECK (((status)::text = ANY ((ARRAY['AVAILABLE'::character varying, 'USED'::character varying, 'EXPIRED'::character varying, 'FAILED'::character varying])::text[])))
);


--
-- Name: service_endpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_endpoints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    service_instance_id uuid NOT NULL,
    protocol character varying(16) NOT NULL,
    host_name character varying(255),
    listen_ip inet,
    port integer NOT NULL,
    path_hint text,
    status character varying(32) DEFAULT 'ACTIVE'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT service_endpoints_port_check CHECK (((port >= 1) AND (port <= 65535))),
    CONSTRAINT service_endpoints_protocol_check CHECK (((protocol)::text = ANY ((ARRAY['HTTPS'::character varying, 'TLS'::character varying, 'STARTTLS'::character varying, 'HTTP'::character varying])::text[]))),
    CONSTRAINT service_endpoints_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'INACTIVE'::character varying, 'UNKNOWN'::character varying])::text[]))),
    CONSTRAINT service_endpoints_version_check CHECK ((version > 0))
);


--
-- Name: service_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_instances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    host_id uuid NOT NULL,
    provider_type character varying(64) NOT NULL,
    service_name character varying(128),
    display_name character varying(255) NOT NULL,
    version_text character varying(128),
    install_path text,
    config_path text,
    runtime_user character varying(128),
    discovery_source character varying(32) NOT NULL,
    last_discovered_at timestamp with time zone,
    status character varying(32) DEFAULT 'ACTIVE'::character varying NOT NULL,
    raw_facts jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT service_instances_discovery_source_check CHECK (((discovery_source)::text = ANY ((ARRAY['AGENT'::character varying, 'SSH'::character varying, 'MANUAL'::character varying, 'GATEWAY'::character varying])::text[]))),
    CONSTRAINT service_instances_provider_type_check CHECK (((provider_type)::text = ANY ((ARRAY['NGINX'::character varying, 'APACHE'::character varying, 'TOMCAT'::character varying, 'IIS'::character varying, 'WINDOWS_CERT_STORE'::character varying, 'CUSTOM'::character varying, 'DEVICE_TEMPLATE'::character varying])::text[]))),
    CONSTRAINT service_instances_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'STALE'::character varying, 'UNREACHABLE'::character varying, 'RETIRED'::character varying])::text[]))),
    CONSTRAINT service_instances_version_check CHECK ((version > 0))
);


--
-- Name: step_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.step_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    execution_step_id uuid NOT NULL,
    result_type character varying(32) NOT NULL,
    result_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT step_results_result_type_check CHECK (((result_type)::text = ANY ((ARRAY['LOG'::character varying, 'OUTPUT'::character varying, 'ASSERTION'::character varying, 'FILE'::character varying, 'METRIC'::character varying])::text[])))
);


--
-- Name: system_initialization_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_initialization_state (
    id character varying(32) NOT NULL,
    status character varying(32) NOT NULL,
    claim_token character varying(128),
    initialized_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT system_initialization_state_singleton CHECK (((id)::text = 'singleton'::text)),
    CONSTRAINT system_initialization_state_status CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'INITIALIZING'::character varying, 'INITIALIZED'::character varying])::text[])))
);


--
-- Name: target_capabilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.target_capabilities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    target_type character varying(32) NOT NULL,
    target_id uuid NOT NULL,
    capability_key character varying(128) NOT NULL,
    capability_value jsonb NOT NULL,
    source character varying(32) NOT NULL,
    confidence integer NOT NULL,
    detected_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT target_capabilities_confidence_check CHECK (((confidence >= 0) AND (confidence <= 100))),
    CONSTRAINT target_capabilities_source_check CHECK (((source)::text = ANY ((ARRAY['DETECTED'::character varying, 'MANUAL'::character varying, 'INHERITED'::character varying, 'ASSUMED'::character varying])::text[]))),
    CONSTRAINT target_capabilities_target_type_check CHECK (((target_type)::text = ANY ((ARRAY['HOST'::character varying, 'AGENT'::character varying, 'GATEWAY'::character varying, 'EXECUTION_TARGET'::character varying])::text[]))),
    CONSTRAINT target_capabilities_version_check CHECK ((version > 0))
);


--
-- Name: task_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_attempts (
    id text NOT NULL,
    task_run_id text NOT NULL,
    attempt_no integer NOT NULL,
    worker_id text NOT NULL,
    lease_expires_at timestamp with time zone NOT NULL,
    status text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    error_code text,
    error_summary text,
    CONSTRAINT task_attempt_status_check CHECK ((status = ANY (ARRAY['RUNNING'::text, 'WAITING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'EXPIRED'::text, 'CANCELLED'::text])))
);


--
-- Name: task_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_definitions (
    id text NOT NULL,
    task_type text NOT NULL,
    version integer NOT NULL,
    category text NOT NULL,
    display_key text NOT NULL,
    executor_key text NOT NULL,
    timeout_seconds integer NOT NULL,
    retry_policy jsonb NOT NULL,
    permission_key text NOT NULL,
    sensitive_paths jsonb DEFAULT '[]'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT task_definition_category_check CHECK ((category = ANY (ARRAY['EXECUTION'::text, 'MONITORING'::text, 'SYSTEM'::text]))),
    CONSTRAINT task_definition_timeout_check CHECK ((timeout_seconds > 0)),
    CONSTRAINT task_definition_version_check CHECK ((version > 0))
);


--
-- Name: task_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_events (
    id text NOT NULL,
    task_run_id text NOT NULL,
    attempt_id text,
    event_type text NOT NULL,
    event_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    actor_type text NOT NULL,
    actor_id text,
    request_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: task_monitor_probes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_monitor_probes (
    id text NOT NULL,
    task_run_id text NOT NULL,
    tenant_id text NOT NULL,
    monitor_target_id text,
    service_asset_id text NOT NULL,
    status text NOT NULL,
    checked_at timestamp with time zone NOT NULL,
    latency_ms integer,
    summary text,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: task_resource_refs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_resource_refs (
    task_run_id text NOT NULL,
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    display_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: task_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_runs (
    id text NOT NULL,
    tenant_id text NOT NULL,
    task_type text NOT NULL,
    definition_version integer NOT NULL,
    category text NOT NULL,
    status text NOT NULL,
    requested_by text,
    trigger_source text NOT NULL,
    resource_summary jsonb,
    idempotency_key text,
    parent_task_id text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    progress jsonb,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    next_attempt_at timestamp with time zone,
    lease_owner text,
    lease_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    last_error_code text,
    last_error_message text,
    CONSTRAINT task_run_category_check CHECK ((category = ANY (ARRAY['EXECUTION'::text, 'MONITORING'::text, 'SYSTEM'::text]))),
    CONSTRAINT task_run_status_check CHECK ((status = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'RETRY_WAITING'::text, 'WAITING_RESULT'::text, 'AWAITING_CONFIRMATION'::text, 'CANCELLING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'CANCELLED'::text])))
);


--
-- Name: tenant_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_type character varying(32) NOT NULL,
    subject_id character varying(128) NOT NULL,
    tenant_id uuid NOT NULL,
    membership_type character varying(32) NOT NULL,
    status character varying(16) DEFAULT 'ACTIVE'::character varying NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    effective_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(128),
    updated_by character varying(128),
    revoked_at timestamp with time zone,
    revoked_by character varying(128),
    version integer DEFAULT 1 NOT NULL,
    expired_at timestamp with time zone,
    CONSTRAINT ck_tenant_memberships_effective_range CHECK (((effective_until IS NULL) OR (effective_until > effective_from))),
    CONSTRAINT ck_tenant_memberships_revocation CHECK (((((status)::text = 'ACTIVE'::text) AND (revoked_at IS NULL) AND (revoked_by IS NULL) AND (expired_at IS NULL)) OR (((status)::text = 'REVOKED'::text) AND (revoked_at IS NOT NULL) AND (revoked_by IS NOT NULL) AND (expired_at IS NULL)) OR (((status)::text = 'EXPIRED'::text) AND (expired_at IS NOT NULL) AND (revoked_at IS NULL) AND (revoked_by IS NULL)))),
    CONSTRAINT tenant_memberships_membership_type_check CHECK (((membership_type)::text = ANY ((ARRAY['owner'::character varying, 'admin'::character varying, 'operator'::character varying, 'auditor'::character varying, 'member'::character varying])::text[]))),
    CONSTRAINT tenant_memberships_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'REVOKED'::character varying, 'EXPIRED'::character varying])::text[]))),
    CONSTRAINT tenant_memberships_subject_type_check CHECK (((subject_type)::text = ANY ((ARRAY['user'::character varying, 'group'::character varying, 'external_group'::character varying])::text[]))),
    CONSTRAINT tenant_memberships_version_check CHECK ((version > 0))
);


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(128) NOT NULL,
    code character varying(64) NOT NULL,
    status character varying(32) DEFAULT 'ACTIVE'::character varying NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    tenant_type character varying(16) NOT NULL,
    parent_id uuid,
    CONSTRAINT ck_tenants_first_level_shape CHECK (((((tenant_type)::text = 'GROUP'::text) AND (parent_id IS NULL)) OR (((tenant_type)::text = 'COMPANY'::text) AND (parent_id IS NOT NULL)))),
    CONSTRAINT ck_tenants_parent_not_self CHECK (((parent_id IS NULL) OR (parent_id <> id))),
    CONSTRAINT ck_tenants_tenant_type CHECK (((tenant_type)::text = ANY ((ARRAY['GROUP'::character varying, 'COMPANY'::character varying])::text[]))),
    CONSTRAINT tenants_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'SUSPENDED'::character varying])::text[]))),
    CONSTRAINT tenants_version_check CHECK ((version > 0))
);


--
-- Name: unified_plugin_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unified_plugin_bindings (
    id character varying(128) NOT NULL,
    tenant_id character varying(128) NOT NULL,
    plugin_version_id character varying(128) NOT NULL,
    mode character varying(32) NOT NULL,
    managed_context jsonb,
    status character varying(32) NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    input_bindings jsonb NOT NULL,
    CONSTRAINT ck_unified_plugin_bindings_input_bindings_v1 CHECK ((((input_bindings ->> 'apiVersion'::text) = 'gcac.input-bindings/v1'::text) AND (jsonb_typeof((input_bindings -> 'variables'::text)) = 'object'::text) AND (jsonb_typeof((input_bindings -> 'connections'::text)) = 'object'::text) AND (jsonb_typeof((input_bindings -> 'credentials'::text)) = 'object'::text) AND (jsonb_typeof((input_bindings -> 'artifacts'::text)) = 'object'::text))),
    CONSTRAINT unified_plugin_bindings_mode_check CHECK (((mode)::text = ANY ((ARRAY['MANAGED'::character varying, 'STANDALONE'::character varying])::text[]))),
    CONSTRAINT unified_plugin_bindings_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'DISABLED'::character varying, 'MIGRATING'::character varying, 'ERROR'::character varying])::text[]))),
    CONSTRAINT unified_plugin_bindings_version_check CHECK ((version > 0))
);


--
-- Name: unified_plugin_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unified_plugin_resources (
    plugin_version_id character varying(128) NOT NULL,
    resource_path character varying(512) NOT NULL,
    resource_content text NOT NULL,
    resource_sha256 character varying(80) NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: unified_plugin_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unified_plugin_versions (
    id character varying(128) NOT NULL,
    tenant_id character varying(128) NOT NULL,
    plugin_id character varying(192) NOT NULL,
    plugin_version character varying(64) NOT NULL,
    source character varying(32) NOT NULL,
    runtime character varying(32) NOT NULL,
    scope character varying(32) NOT NULL,
    trust character varying(32) NOT NULL,
    support character varying(32) NOT NULL,
    manifest jsonb NOT NULL,
    package_sha256 character varying(80) NOT NULL,
    manifest_sha256 character varying(80) NOT NULL,
    resource_sha256 jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(32) NOT NULL,
    permission_approval_status character varying(32) NOT NULL,
    approved_permissions jsonb DEFAULT '[]'::jsonb NOT NULL,
    validation_report jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    owner_type character varying(16) DEFAULT 'TENANT'::character varying NOT NULL,
    owner_id character varying(128),
    CONSTRAINT ck_unified_plugin_versions_canonical_id CHECK (((NOT (((source)::text = 'BUILTIN'::text) AND ((runtime)::text = 'AGENT_PLAN'::text))) OR ((status)::text = ANY ((ARRAY['RETIRED'::character varying, 'QUARANTINED'::character varying])::text[])) OR ((plugin_id)::text = ANY ((ARRAY['web.nginx'::character varying, 'web.apache'::character varying, 'web.iis'::character varying, 'app.tomcat'::character varying, 'app.java-keystore'::character varying, 'app.rabbitmq'::character varying, 'app.service-certificate-file'::character varying, 'device.citrix.netscaler-adc'::character varying, 'device.synology-dsm'::character varying, 'cloud.aliyun'::character varying, 'cloud.tencent'::character varying, 'cloud.huawei'::character varying, 'cloud.volcengine'::character varying, 'ca.openssl'::character varying, 'ca.acme'::character varying, 'ca.microsoft-adcs'::character varying, 'ca.acme-dns'::character varying])::text[])))),
    CONSTRAINT ck_unified_plugin_versions_manifest_object CHECK (((NOT (((source)::text = 'BUILTIN'::text) AND ((runtime)::text = 'AGENT_ATOMIC'::text))) OR ((status)::text = ANY ((ARRAY['RETIRED'::character varying, 'QUARANTINED'::character varying])::text[])) OR (jsonb_typeof(manifest) = 'object'::text))),
    CONSTRAINT ck_unified_plugin_versions_manifest_sha256 CHECK (((NOT (((source)::text = 'BUILTIN'::text) AND ((runtime)::text = 'AGENT_ATOMIC'::text))) OR ((status)::text = ANY ((ARRAY['RETIRED'::character varying, 'QUARANTINED'::character varying])::text[])) OR ((manifest_sha256)::text ~ '^sha256:[a-f0-9]{64}$'::text))),
    CONSTRAINT ck_unified_plugin_versions_owner_type CHECK (((owner_type)::text = ANY ((ARRAY['SYSTEM'::character varying, 'TENANT'::character varying])::text[]))),
    CONSTRAINT ck_unified_plugin_versions_package_sha256 CHECK (((NOT (((source)::text = 'BUILTIN'::text) AND ((runtime)::text = 'AGENT_ATOMIC'::text))) OR ((status)::text = ANY ((ARRAY['RETIRED'::character varying, 'QUARANTINED'::character varying])::text[])) OR ((package_sha256)::text ~ '^sha256:[a-f0-9]{64}$'::text))),
    CONSTRAINT ck_unified_plugin_versions_plugin_version CHECK (((NOT (((source)::text = 'BUILTIN'::text) AND ((runtime)::text = 'AGENT_ATOMIC'::text))) OR ((status)::text = ANY ((ARRAY['RETIRED'::character varying, 'QUARANTINED'::character varying])::text[])) OR ((plugin_version)::text ~ '^[0-9]+[.][0-9]+[.][0-9]+([-][0-9A-Za-z.-]+)?([+][0-9A-Za-z.-]+)?$'::text))),
    CONSTRAINT ck_unified_plugin_versions_resource_hashes CHECK (((NOT (((source)::text = 'BUILTIN'::text) AND ((runtime)::text = 'AGENT_ATOMIC'::text))) OR ((status)::text = ANY ((ARRAY['RETIRED'::character varying, 'QUARANTINED'::character varying])::text[])) OR (jsonb_typeof(resource_sha256) = 'object'::text))),
    CONSTRAINT ck_unified_plugin_versions_runner_manifest CHECK (((NOT (((source)::text = 'BUILTIN'::text) AND ((runtime)::text = 'AGENT_ATOMIC'::text))) OR ((status)::text = ANY ((ARRAY['RETIRED'::character varying, 'QUARANTINED'::character varying])::text[])) OR (((manifest ->> 'pluginId'::text) = (plugin_id)::text) AND ((manifest ->> 'canonicalPluginId'::text) = (plugin_id)::text) AND ((manifest ->> 'executionMode'::text) = 'isolated_process'::text) AND ((manifest ->> 'version'::text) = (plugin_version)::text)))),
    CONSTRAINT unified_plugin_versions_permission_approval_status_check CHECK (((permission_approval_status)::text = ANY ((ARRAY['NOT_REQUIRED'::character varying, 'PENDING'::character varying, 'APPROVED'::character varying, 'REJECTED'::character varying])::text[]))),
    CONSTRAINT unified_plugin_versions_runtime_check CHECK (((runtime)::text = ANY ((ARRAY['AGENT_PLAN'::character varying, 'WORKFLOW_DSL'::character varying, 'TRUSTED_JS'::character varying])::text[]))),
    CONSTRAINT unified_plugin_versions_scope_check CHECK (((scope)::text = ANY ((ARRAY['MANAGED'::character varying, 'STANDALONE'::character varying, 'BOTH'::character varying])::text[]))),
    CONSTRAINT unified_plugin_versions_source_check CHECK (((source)::text = ANY ((ARRAY['BUILTIN'::character varying, 'USER'::character varying])::text[]))),
    CONSTRAINT unified_plugin_versions_status_check CHECK (((status)::text = ANY ((ARRAY['IMPORTED'::character varying, 'PENDING_APPROVAL'::character varying, 'DISABLED'::character varying, 'ENABLED'::character varying, 'RETIRED'::character varying, 'QUARANTINED'::character varying])::text[]))),
    CONSTRAINT unified_plugin_versions_support_check CHECK (((support)::text = ANY ((ARRAY['OFFICIAL'::character varying, 'COMMUNITY'::character varying, 'SELF_MANAGED'::character varying])::text[]))),
    CONSTRAINT unified_plugin_versions_trust_check CHECK (((trust)::text = ANY ((ARRAY['OFFICIAL_SIGNED'::character varying, 'USER_SIGNED'::character varying, 'UNSIGNED'::character varying])::text[])))
);


--
-- Name: unified_plugin_workflow_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unified_plugin_workflow_bindings (
    plugin_version_id character varying(128) NOT NULL,
    capability_key character varying(192) NOT NULL,
    workflow_resource_path character varying(512) NOT NULL,
    workflow_template_id character varying(128) NOT NULL,
    workflow_version_id character varying(128) NOT NULL,
    workflow_content_sha256 character varying(80) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    owner_type character varying(16) DEFAULT 'SYSTEM'::character varying NOT NULL,
    owner_id character varying(128),
    workflow_key character varying(192) NOT NULL,
    CONSTRAINT ck_unified_plugin_workflow_bindings_owner_type CHECK (((owner_type)::text = ANY ((ARRAY['SYSTEM'::character varying, 'TENANT'::character varying])::text[]))),
    CONSTRAINT ck_unified_plugin_workflow_bindings_workflow_key CHECK ((length(TRIM(BOTH FROM workflow_key)) > 0))
);


--
-- Name: workflow_execution_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_execution_bindings (
    id text NOT NULL,
    tenant_id text NOT NULL,
    workflow_template_id text NOT NULL,
    workflow_version_selection text NOT NULL,
    workflow_version_id text NOT NULL,
    runner text NOT NULL,
    gateway_id text,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    input_bindings jsonb NOT NULL,
    plugin_version_id character varying(128) NOT NULL,
    capability_key character varying(192) NOT NULL,
    workflow_key character varying(192) NOT NULL,
    CONSTRAINT ck_workflow_execution_bindings_fixed_identity CHECK (((length(TRIM(BOTH FROM plugin_version_id)) > 0) AND (length(TRIM(BOTH FROM capability_key)) > 0) AND (length(TRIM(BOTH FROM workflow_template_id)) > 0) AND (length(TRIM(BOTH FROM workflow_version_id)) > 0))),
    CONSTRAINT ck_workflow_execution_bindings_gateway CHECK ((((runner = 'GATEWAY'::text) AND (gateway_id IS NOT NULL)) OR ((runner = 'CONTROL_PLANE'::text) AND (gateway_id IS NULL)))),
    CONSTRAINT ck_workflow_execution_bindings_input_bindings_v1 CHECK ((((input_bindings ->> 'apiVersion'::text) = 'gcac.input-bindings/v1'::text) AND (jsonb_typeof((input_bindings -> 'variables'::text)) = 'object'::text) AND (jsonb_typeof((input_bindings -> 'connections'::text)) = 'object'::text) AND (jsonb_typeof((input_bindings -> 'credentials'::text)) = 'object'::text) AND (jsonb_typeof((input_bindings -> 'artifacts'::text)) = 'object'::text))),
    CONSTRAINT ck_workflow_execution_bindings_runner CHECK ((runner = ANY (ARRAY['CONTROL_PLANE'::text, 'GATEWAY'::text]))),
    CONSTRAINT ck_workflow_execution_bindings_status CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'DISABLED'::text]))),
    CONSTRAINT ck_workflow_execution_bindings_version_selection_fixed CHECK ((workflow_version_selection = 'FIXED'::text)),
    CONSTRAINT ck_workflow_execution_bindings_workflow_key CHECK ((length(TRIM(BOTH FROM workflow_key)) > 0))
);


--
-- Name: workflow_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_template_id uuid NOT NULL,
    execution_run_id uuid,
    status character varying(32) NOT NULL,
    input_snapshot jsonb,
    output_summary jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT workflow_runs_status_check CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'RUNNING'::character varying, 'SUCCESS'::character varying, 'FAILED'::character varying, 'CANCELLED'::character varying])::text[]))),
    CONSTRAINT workflow_runs_version_check CHECK ((version > 0))
);


--
-- Name: workflow_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    template_type character varying(32) NOT NULL,
    name character varying(128) NOT NULL,
    vendor character varying(128),
    device_type character varying(128),
    dsl_version character varying(32) NOT NULL,
    definition jsonb NOT NULL,
    status character varying(32) DEFAULT 'DRAFT'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT workflow_templates_status_check CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'PUBLISHED'::character varying, 'DEPRECATED'::character varying])::text[]))),
    CONSTRAINT workflow_templates_template_type_check CHECK (((template_type)::text = ANY ((ARRAY['CURL'::character varying, 'SSH'::character varying, 'HYBRID'::character varying])::text[]))),
    CONSTRAINT workflow_templates_version_check CHECK ((version > 0))
);


--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);


--
-- Name: app_documents app_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_documents
    ADD CONSTRAINT app_documents_pkey PRIMARY KEY (namespace, document_id);


--
-- Name: application_onboarding_sessions application_onboarding_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_onboarding_sessions
    ADD CONSTRAINT application_onboarding_sessions_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: automation_definitions automation_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_definitions
    ADD CONSTRAINT automation_definitions_pkey PRIMARY KEY (id);


--
-- Name: automation_run_action_results automation_run_action_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_run_action_results
    ADD CONSTRAINT automation_run_action_results_pkey PRIMARY KEY (id);


--
-- Name: automation_run_targets automation_run_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_run_targets
    ADD CONSTRAINT automation_run_targets_pkey PRIMARY KEY (id);


--
-- Name: automation_run_targets automation_run_targets_run_id_sequence_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_run_targets
    ADD CONSTRAINT automation_run_targets_run_id_sequence_no_key UNIQUE (run_id, sequence_no);


--
-- Name: automation_runs automation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_pkey PRIMARY KEY (id);


--
-- Name: automation_runs automation_runs_tenant_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_tenant_id_idempotency_key_key UNIQUE (tenant_id, idempotency_key);


--
-- Name: automation_scheduler_leases automation_scheduler_leases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_scheduler_leases
    ADD CONSTRAINT automation_scheduler_leases_pkey PRIMARY KEY (lease_key);


--
-- Name: automation_trigger_deliveries automation_trigger_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_trigger_deliveries
    ADD CONSTRAINT automation_trigger_deliveries_pkey PRIMARY KEY (id);


--
-- Name: automation_trigger_deliveries automation_trigger_deliveries_tenant_id_automation_id_autom_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_trigger_deliveries
    ADD CONSTRAINT automation_trigger_deliveries_tenant_id_automation_id_autom_key UNIQUE (tenant_id, automation_id, automation_version, delivery_key);


--
-- Name: automation_versions automation_versions_automation_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_versions
    ADD CONSTRAINT automation_versions_automation_id_version_key UNIQUE (automation_id, version);


--
-- Name: automation_versions automation_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_versions
    ADD CONSTRAINT automation_versions_pkey PRIMARY KEY (id);


--
-- Name: backup_artifacts backup_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_artifacts
    ADD CONSTRAINT backup_artifacts_pkey PRIMARY KEY (id);


--
-- Name: browser_credential_sessions browser_credential_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.browser_credential_sessions
    ADD CONSTRAINT browser_credential_sessions_pkey PRIMARY KEY (id);


--
-- Name: browser_credential_sessions browser_credential_sessions_runtime_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.browser_credential_sessions
    ADD CONSTRAINT browser_credential_sessions_runtime_session_id_key UNIQUE (runtime_session_id);


--
-- Name: certificate_assets certificate_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_assets
    ADD CONSTRAINT certificate_assets_pkey PRIMARY KEY (id);


--
-- Name: certificate_bindings certificate_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_bindings
    ADD CONSTRAINT certificate_bindings_pkey PRIMARY KEY (id);


--
-- Name: certificate_observations certificate_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_observations
    ADD CONSTRAINT certificate_observations_pkey PRIMARY KEY (id);


--
-- Name: certificate_version_formats certificate_version_formats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_version_formats
    ADD CONSTRAINT certificate_version_formats_pkey PRIMARY KEY (id);


--
-- Name: certificate_versions certificate_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_versions
    ADD CONSTRAINT certificate_versions_pkey PRIMARY KEY (id);


--
-- Name: credential_profiles credential_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credential_profiles
    ADD CONSTRAINT credential_profiles_pkey PRIMARY KEY (id);


--
-- Name: database_forward_cleanup_audits database_forward_cleanup_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.database_forward_cleanup_audits
    ADD CONSTRAINT database_forward_cleanup_audits_pkey PRIMARY KEY (migration_version, source_table, source_namespace, source_id, cleanup_action);


--
-- Name: deployment_input_artifact_binding_migration_backups deployment_input_artifact_binding_migration_backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployment_input_artifact_binding_migration_backups
    ADD CONSTRAINT deployment_input_artifact_binding_migration_backups_pkey PRIMARY KEY (plugin_binding_id);


--
-- Name: deployment_input_binding_repair_backups deployment_input_binding_repair_backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployment_input_binding_repair_backups
    ADD CONSTRAINT deployment_input_binding_repair_backups_pkey PRIMARY KEY (plugin_binding_id);


--
-- Name: deployment_input_binding_repairs deployment_input_binding_repairs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployment_input_binding_repairs
    ADD CONSTRAINT deployment_input_binding_repairs_pkey PRIMARY KEY (tenant_id, application_asset_id, capability_key);


--
-- Name: deployment_input_binding_sanitization_backups deployment_input_binding_sanitization_backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployment_input_binding_sanitization_backups
    ADD CONSTRAINT deployment_input_binding_sanitization_backups_pkey PRIMARY KEY (plugin_binding_id);


--
-- Name: deployment_input_snapshots deployment_input_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployment_input_snapshots
    ADD CONSTRAINT deployment_input_snapshots_pkey PRIMARY KEY (id);


--
-- Name: deployment_plan_targets deployment_plan_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployment_plan_targets
    ADD CONSTRAINT deployment_plan_targets_pkey PRIMARY KEY (id);


--
-- Name: deployment_plans deployment_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployment_plans
    ADD CONSTRAINT deployment_plans_pkey PRIMARY KEY (id);


--
-- Name: execution_runs execution_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_runs
    ADD CONSTRAINT execution_runs_pkey PRIMARY KEY (id);


--
-- Name: execution_steps execution_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_steps
    ADD CONSTRAINT execution_steps_pkey PRIMARY KEY (id);


--
-- Name: execution_targets execution_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_targets
    ADD CONSTRAINT execution_targets_pkey PRIMARY KEY (id);


--
-- Name: gateways gateways_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateways
    ADD CONSTRAINT gateways_pkey PRIMARY KEY (id);


--
-- Name: hosts hosts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hosts
    ADD CONSTRAINT hosts_pkey PRIMARY KEY (id);


--
-- Name: idempotency_records idempotency_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_records
    ADD CONSTRAINT idempotency_records_pkey PRIMARY KEY (id);


--
-- Name: idempotency_records idempotency_records_tenant_id_action_type_resource_type_res_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_records
    ADD CONSTRAINT idempotency_records_tenant_id_action_type_resource_type_res_key UNIQUE (tenant_id, action_type, resource_type, resource_id, idempotency_key);


--
-- Name: job_queue job_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_queue
    ADD CONSTRAINT job_queue_pkey PRIMARY KEY (job_id);


--
-- Name: metric_snapshot_runs metric_snapshot_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_snapshot_runs
    ADD CONSTRAINT metric_snapshot_runs_pkey PRIMARY KEY (id);


--
-- Name: metric_snapshot_runs metric_snapshot_runs_tenant_id_snapshot_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_snapshot_runs
    ADD CONSTRAINT metric_snapshot_runs_tenant_id_snapshot_date_key UNIQUE (tenant_id, snapshot_date);


--
-- Name: metric_snapshots metric_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_snapshots
    ADD CONSTRAINT metric_snapshots_pkey PRIMARY KEY (id);


--
-- Name: metric_snapshots metric_snapshots_tenant_id_snapshot_date_metric_key_metric__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_snapshots
    ADD CONSTRAINT metric_snapshots_tenant_id_snapshot_date_metric_key_metric__key UNIQUE (tenant_id, snapshot_date, metric_key, metric_version, dimension_key);


--
-- Name: monitor_targets monitor_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monitor_targets
    ADD CONSTRAINT monitor_targets_pkey PRIMARY KEY (id);


--
-- Name: notification_channels notification_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_channels
    ADD CONSTRAINT notification_channels_pkey PRIMARY KEY (id);


--
-- Name: notification_deliveries notification_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_pkey PRIMARY KEY (id);


--
-- Name: notification_delivery_attempts notification_delivery_attempts_delivery_id_attempt_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_delivery_attempts
    ADD CONSTRAINT notification_delivery_attempts_delivery_id_attempt_no_key UNIQUE (delivery_id, attempt_no);


--
-- Name: notification_delivery_attempts notification_delivery_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_delivery_attempts
    ADD CONSTRAINT notification_delivery_attempts_pkey PRIMARY KEY (id);


--
-- Name: notification_requests notification_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_requests
    ADD CONSTRAINT notification_requests_pkey PRIMARY KEY (id);


--
-- Name: notification_requests notification_requests_tenant_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_requests
    ADD CONSTRAINT notification_requests_tenant_id_idempotency_key_key UNIQUE (tenant_id, idempotency_key);


--
-- Name: notification_routes notification_routes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_routes
    ADD CONSTRAINT notification_routes_pkey PRIMARY KEY (id);


--
-- Name: notification_settings notification_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_settings
    ADD CONSTRAINT notification_settings_pkey PRIMARY KEY (tenant_id);


--
-- Name: notification_silences notification_silences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_silences
    ADD CONSTRAINT notification_silences_pkey PRIMARY KEY (id);


--
-- Name: notification_templates notification_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_templates
    ADD CONSTRAINT notification_templates_pkey PRIMARY KEY (id);


--
-- Name: notification_templates notification_templates_tenant_id_template_key_locale_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_templates
    ADD CONSTRAINT notification_templates_tenant_id_template_key_locale_key UNIQUE (tenant_id, template_key, locale);


--
-- Name: object_permission_access_grants object_permission_access_gran_role_id_object_set_id_access__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_permission_access_grants
    ADD CONSTRAINT object_permission_access_gran_role_id_object_set_id_access__key UNIQUE (role_id, object_set_id, access_level, effect);


--
-- Name: object_permission_access_grants object_permission_access_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_permission_access_grants
    ADD CONSTRAINT object_permission_access_grants_pkey PRIMARY KEY (id);


--
-- Name: object_permission_group_members object_permission_group_members_group_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_permission_group_members
    ADD CONSTRAINT object_permission_group_members_group_id_user_id_key UNIQUE (group_id, user_id);


--
-- Name: object_permission_group_members object_permission_group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_permission_group_members
    ADD CONSTRAINT object_permission_group_members_pkey PRIMARY KEY (id);


--
-- Name: object_permission_groups object_permission_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_permission_groups
    ADD CONSTRAINT object_permission_groups_pkey PRIMARY KEY (id);


--
-- Name: object_permission_groups object_permission_groups_tenant_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_permission_groups
    ADD CONSTRAINT object_permission_groups_tenant_id_code_key UNIQUE (tenant_id, code);


--
-- Name: object_permission_groups object_permission_groups_tenant_id_source_external_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_permission_groups
    ADD CONSTRAINT object_permission_groups_tenant_id_source_external_ref_key UNIQUE (tenant_id, source, external_ref);


--
-- Name: object_permission_object_set_members object_permission_object_set__object_set_id_object_type_obj_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_permission_object_set_members
    ADD CONSTRAINT object_permission_object_set__object_set_id_object_type_obj_key UNIQUE (object_set_id, object_type, object_id);


--
-- Name: object_permission_object_set_members object_permission_object_set_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_permission_object_set_members
    ADD CONSTRAINT object_permission_object_set_members_pkey PRIMARY KEY (id);


--
-- Name: object_permission_object_sets object_permission_object_sets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_permission_object_sets
    ADD CONSTRAINT object_permission_object_sets_pkey PRIMARY KEY (id);


--
-- Name: object_permission_object_types object_permission_object_types_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_permission_object_types
    ADD CONSTRAINT object_permission_object_types_code_key UNIQUE (code);


--
-- Name: object_permission_object_types object_permission_object_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_permission_object_types
    ADD CONSTRAINT object_permission_object_types_pkey PRIMARY KEY (id);


--
-- Name: object_permission_role_bindings object_permission_role_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_permission_role_bindings
    ADD CONSTRAINT object_permission_role_bindings_pkey PRIMARY KEY (id);


--
-- Name: pg_acme_accounts pg_acme_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_accounts
    ADD CONSTRAINT pg_acme_accounts_pkey PRIMARY KEY (id);


--
-- Name: pg_acme_authorizations pg_acme_authorizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_authorizations
    ADD CONSTRAINT pg_acme_authorizations_pkey PRIMARY KEY (id);


--
-- Name: pg_acme_challenges pg_acme_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_challenges
    ADD CONSTRAINT pg_acme_challenges_pkey PRIMARY KEY (id);


--
-- Name: pg_acme_http01_presentations pg_acme_http01_presentations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_http01_presentations
    ADD CONSTRAINT pg_acme_http01_presentations_pkey PRIMARY KEY (token_sha256);


--
-- Name: pg_acme_orders pg_acme_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_orders
    ADD CONSTRAINT pg_acme_orders_pkey PRIMARY KEY (id);


--
-- Name: pg_acme_plugin_accounts pg_acme_plugin_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_plugin_accounts
    ADD CONSTRAINT pg_acme_plugin_accounts_pkey PRIMARY KEY (id);


--
-- Name: pg_acme_plugin_challenges pg_acme_plugin_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_plugin_challenges
    ADD CONSTRAINT pg_acme_plugin_challenges_pkey PRIMARY KEY (id);


--
-- Name: pg_acme_plugin_operations pg_acme_plugin_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_plugin_operations
    ADD CONSTRAINT pg_acme_plugin_operations_pkey PRIMARY KEY (id);


--
-- Name: pg_acme_plugin_requests pg_acme_plugin_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_plugin_requests
    ADD CONSTRAINT pg_acme_plugin_requests_pkey PRIMARY KEY (id);


--
-- Name: pg_acme_renewal_policies pg_acme_renewal_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_renewal_policies
    ADD CONSTRAINT pg_acme_renewal_policies_pkey PRIMARY KEY (id);


--
-- Name: pg_agent_capability_snapshot_current pg_agent_capability_snapshot_current_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_agent_capability_snapshot_current
    ADD CONSTRAINT pg_agent_capability_snapshot_current_pkey PRIMARY KEY (tenant_id, agent_id);


--
-- Name: pg_agent_snapshot_retention_runs pg_agent_snapshot_retention_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_agent_snapshot_retention_runs
    ADD CONSTRAINT pg_agent_snapshot_retention_runs_pkey PRIMARY KEY (run_id);


--
-- Name: pg_application_asset_targets pg_application_asset_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_application_asset_targets
    ADD CONSTRAINT pg_application_asset_targets_pkey PRIMARY KEY (id);


--
-- Name: pg_asset_conflicts pg_asset_conflicts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_asset_conflicts
    ADD CONSTRAINT pg_asset_conflicts_pkey PRIMARY KEY (id);


--
-- Name: pg_business_permission_grants pg_business_permission_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_business_permission_grants
    ADD CONSTRAINT pg_business_permission_grants_pkey PRIMARY KEY (id);


--
-- Name: pg_business_permission_relations pg_business_permission_relations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_business_permission_relations
    ADD CONSTRAINT pg_business_permission_relations_pkey PRIMARY KEY (id);


--
-- Name: pg_ca_capability_records pg_ca_capability_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_capability_records
    ADD CONSTRAINT pg_ca_capability_records_pkey PRIMARY KEY (id);


--
-- Name: pg_ca_external_observations pg_ca_external_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_external_observations
    ADD CONSTRAINT pg_ca_external_observations_pkey PRIMARY KEY (id);


--
-- Name: pg_ca_issuance_records pg_ca_issuance_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_issuance_records
    ADD CONSTRAINT pg_ca_issuance_records_pkey PRIMARY KEY (id);


--
-- Name: pg_ca_node_enrollment_tokens pg_ca_node_enrollment_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_node_enrollment_tokens
    ADD CONSTRAINT pg_ca_node_enrollment_tokens_pkey PRIMARY KEY (id);


--
-- Name: pg_ca_node_request_nonces pg_ca_node_request_nonces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_node_request_nonces
    ADD CONSTRAINT pg_ca_node_request_nonces_pkey PRIMARY KEY (node_id, nonce);


--
-- Name: pg_ca_node_tasks pg_ca_node_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_node_tasks
    ADD CONSTRAINT pg_ca_node_tasks_pkey PRIMARY KEY (id);


--
-- Name: pg_ca_nodes pg_ca_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_nodes
    ADD CONSTRAINT pg_ca_nodes_pkey PRIMARY KEY (id);


--
-- Name: pg_ca_providers pg_ca_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_providers
    ADD CONSTRAINT pg_ca_providers_pkey PRIMARY KEY (id);


--
-- Name: pg_ca_serial_states pg_ca_serial_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_serial_states
    ADD CONSTRAINT pg_ca_serial_states_pkey PRIMARY KEY (tenant_id, ca_id);


--
-- Name: pg_ca_sync_runs pg_ca_sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_sync_runs
    ADD CONSTRAINT pg_ca_sync_runs_pkey PRIMARY KEY (id);


--
-- Name: pg_ca_template_mappings pg_ca_template_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_template_mappings
    ADD CONSTRAINT pg_ca_template_mappings_pkey PRIMARY KEY (id);


--
-- Name: pg_ca_trust_domains pg_ca_trust_domains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_trust_domains
    ADD CONSTRAINT pg_ca_trust_domains_pkey PRIMARY KEY (id);


--
-- Name: pg_certificate_artifacts pg_certificate_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_artifacts
    ADD CONSTRAINT pg_certificate_artifacts_pkey PRIMARY KEY (tenant_id, artifact_ref);


--
-- Name: pg_certificate_assets pg_certificate_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_assets
    ADD CONSTRAINT pg_certificate_assets_pkey PRIMARY KEY (id);


--
-- Name: pg_certificate_authorities pg_certificate_authorities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_authorities
    ADD CONSTRAINT pg_certificate_authorities_pkey PRIMARY KEY (id);


--
-- Name: pg_certificate_bindings pg_certificate_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_bindings
    ADD CONSTRAINT pg_certificate_bindings_pkey PRIMARY KEY (id);


--
-- Name: pg_certificate_issuances pg_certificate_issuances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_issuances
    ADD CONSTRAINT pg_certificate_issuances_pkey PRIMARY KEY (id);


--
-- Name: pg_certificate_profile_versions pg_certificate_profile_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_profile_versions
    ADD CONSTRAINT pg_certificate_profile_versions_pkey PRIMARY KEY (id);


--
-- Name: pg_certificate_profiles pg_certificate_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_profiles
    ADD CONSTRAINT pg_certificate_profiles_pkey PRIMARY KEY (id);


--
-- Name: pg_certificate_renewal_jobs pg_certificate_renewal_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_renewal_jobs
    ADD CONSTRAINT pg_certificate_renewal_jobs_pkey PRIMARY KEY (id);


--
-- Name: pg_certificate_requests pg_certificate_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_requests
    ADD CONSTRAINT pg_certificate_requests_pkey PRIMARY KEY (id);


--
-- Name: pg_certificate_revocations pg_certificate_revocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_revocations
    ADD CONSTRAINT pg_certificate_revocations_pkey PRIMARY KEY (id);


--
-- Name: pg_certificate_version_formats pg_certificate_version_formats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_version_formats
    ADD CONSTRAINT pg_certificate_version_formats_pkey PRIMARY KEY (id);


--
-- Name: pg_certificate_version_trust_roots pg_certificate_version_trust_roots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_version_trust_roots
    ADD CONSTRAINT pg_certificate_version_trust_roots_pkey PRIMARY KEY (id);


--
-- Name: pg_certificate_versions pg_certificate_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_versions
    ADD CONSTRAINT pg_certificate_versions_pkey PRIMARY KEY (id);


--
-- Name: pg_cloud_account_assets pg_cloud_account_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_cloud_account_assets
    ADD CONSTRAINT pg_cloud_account_assets_pkey PRIMARY KEY (id);


--
-- Name: pg_data_correction_batches pg_data_correction_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_data_correction_batches
    ADD CONSTRAINT pg_data_correction_batches_pkey PRIMARY KEY (id);


--
-- Name: pg_device_assets pg_device_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_device_assets
    ADD CONSTRAINT pg_device_assets_pkey PRIMARY KEY (service_asset_id);


--
-- Name: pg_device_certificate_bindings pg_device_certificate_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_device_certificate_bindings
    ADD CONSTRAINT pg_device_certificate_bindings_pkey PRIMARY KEY (id);


--
-- Name: pg_device_certificate_resources pg_device_certificate_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_device_certificate_resources
    ADD CONSTRAINT pg_device_certificate_resources_pkey PRIMARY KEY (id);


--
-- Name: pg_device_liveness_scheduler_leases pg_device_liveness_scheduler_leases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_device_liveness_scheduler_leases
    ADD CONSTRAINT pg_device_liveness_scheduler_leases_pkey PRIMARY KEY (lease_key);


--
-- Name: pg_device_liveness_signals pg_device_liveness_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_device_liveness_signals
    ADD CONSTRAINT pg_device_liveness_signals_pkey PRIMARY KEY (id);


--
-- Name: pg_device_liveness_signals pg_device_liveness_signals_tenant_id_resource_type_resource_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_device_liveness_signals
    ADD CONSTRAINT pg_device_liveness_signals_tenant_id_resource_type_resource_key UNIQUE (tenant_id, resource_type, resource_id, signal_type);


--
-- Name: pg_device_virtual_servers pg_device_virtual_servers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_device_virtual_servers
    ADD CONSTRAINT pg_device_virtual_servers_pkey PRIMARY KEY (id);


--
-- Name: pg_discovery_snapshots pg_discovery_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_discovery_snapshots
    ADD CONSTRAINT pg_discovery_snapshots_pkey PRIMARY KEY (id);


--
-- Name: pg_documents pg_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_documents
    ADD CONSTRAINT pg_documents_pkey PRIMARY KEY (namespace, document_id);


--
-- Name: pg_execution_runs pg_execution_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_execution_runs
    ADD CONSTRAINT pg_execution_runs_pkey PRIMARY KEY (id);


--
-- Name: pg_execution_steps pg_execution_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_execution_steps
    ADD CONSTRAINT pg_execution_steps_pkey PRIMARY KEY (id);


--
-- Name: pg_gateway_credential_sessions pg_gateway_credential_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_gateway_credential_sessions
    ADD CONSTRAINT pg_gateway_credential_sessions_pkey PRIMARY KEY (id);


--
-- Name: pg_gateway_reachability pg_gateway_reachability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_gateway_reachability
    ADD CONSTRAINT pg_gateway_reachability_pkey PRIMARY KEY (id);


--
-- Name: pg_gateway_zones pg_gateway_zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_gateway_zones
    ADD CONSTRAINT pg_gateway_zones_pkey PRIMARY KEY (tenant_id, id);


--
-- Name: pg_gateways pg_gateways_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_gateways
    ADD CONSTRAINT pg_gateways_pkey PRIMARY KEY (id);


--
-- Name: pg_hosts pg_hosts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_hosts
    ADD CONSTRAINT pg_hosts_pkey PRIMARY KEY (id);


--
-- Name: pg_key_references pg_key_references_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_key_references
    ADD CONSTRAINT pg_key_references_pkey PRIMARY KEY (id);


--
-- Name: pg_managed_target_snapshots pg_managed_target_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_managed_target_snapshots
    ADD CONSTRAINT pg_managed_target_snapshots_pkey PRIMARY KEY (id);


--
-- Name: pg_managed_targets pg_managed_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_managed_targets
    ADD CONSTRAINT pg_managed_targets_pkey PRIMARY KEY (id);


--
-- Name: pg_monitor_alert_rules pg_monitor_alert_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_monitor_alert_rules
    ADD CONSTRAINT pg_monitor_alert_rules_pkey PRIMARY KEY (id);


--
-- Name: pg_monitor_certificate_observations pg_monitor_certificate_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_monitor_certificate_observations
    ADD CONSTRAINT pg_monitor_certificate_observations_pkey PRIMARY KEY (id);


--
-- Name: pg_monitor_probe_results pg_monitor_probe_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_monitor_probe_results
    ADD CONSTRAINT pg_monitor_probe_results_pkey PRIMARY KEY (id);


--
-- Name: pg_monitor_risk_events pg_monitor_risk_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_monitor_risk_events
    ADD CONSTRAINT pg_monitor_risk_events_pkey PRIMARY KEY (id);


--
-- Name: pg_monitor_scheduler_windows pg_monitor_scheduler_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_monitor_scheduler_windows
    ADD CONSTRAINT pg_monitor_scheduler_windows_pkey PRIMARY KEY (tenant_id, window_start);


--
-- Name: pg_monitor_targets pg_monitor_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_monitor_targets
    ADD CONSTRAINT pg_monitor_targets_pkey PRIMARY KEY (id);


--
-- Name: pg_root_certificate_records pg_root_certificate_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_root_certificate_records
    ADD CONSTRAINT pg_root_certificate_records_pkey PRIMARY KEY (id);


--
-- Name: pg_root_certificate_source_observations pg_root_certificate_source_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_root_certificate_source_observations
    ADD CONSTRAINT pg_root_certificate_source_observations_pkey PRIMARY KEY (id);


--
-- Name: pg_service_assets pg_service_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_service_assets
    ADD CONSTRAINT pg_service_assets_pkey PRIMARY KEY (id);


--
-- Name: pg_service_endpoints pg_service_endpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_service_endpoints
    ADD CONSTRAINT pg_service_endpoints_pkey PRIMARY KEY (id);


--
-- Name: pg_framework_instances pg_service_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_framework_instances
    ADD CONSTRAINT pg_service_instances_pkey PRIMARY KEY (id);


--
-- Name: pg_site_assets pg_site_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_site_assets
    ADD CONSTRAINT pg_site_assets_pkey PRIMARY KEY (id);


--
-- Name: pg_trust_distributions pg_trust_distributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_trust_distributions
    ADD CONSTRAINT pg_trust_distributions_pkey PRIMARY KEY (id);


--
-- Name: unified_plugin_workflow_bindings pk_unified_plugin_workflow_bindings_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unified_plugin_workflow_bindings
    ADD CONSTRAINT pk_unified_plugin_workflow_bindings_identity PRIMARY KEY (plugin_version_id, capability_key, workflow_key);


--
-- Name: plugin_capability_assignments plugin_capability_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_capability_assignments
    ADD CONSTRAINT plugin_capability_assignments_pkey PRIMARY KEY (id);


--
-- Name: plugin_discovered_certificate_bindings plugin_discovered_certificate_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_discovered_certificate_bindings
    ADD CONSTRAINT plugin_discovered_certificate_bindings_pkey PRIMARY KEY (id);


--
-- Name: plugin_discovered_certificate_bindings plugin_discovered_certificate_tenant_id_device_asset_id_st_key1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_discovered_certificate_bindings
    ADD CONSTRAINT plugin_discovered_certificate_tenant_id_device_asset_id_st_key1 UNIQUE (tenant_id, device_asset_id, stable_key);


--
-- Name: plugin_discovered_certificates plugin_discovered_certificate_tenant_id_device_asset_id_sta_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_discovered_certificates
    ADD CONSTRAINT plugin_discovered_certificate_tenant_id_device_asset_id_sta_key UNIQUE (tenant_id, device_asset_id, stable_key);


--
-- Name: plugin_discovered_certificates plugin_discovered_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_discovered_certificates
    ADD CONSTRAINT plugin_discovered_certificates_pkey PRIMARY KEY (id);


--
-- Name: plugin_discovery_snapshots plugin_discovery_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_discovery_snapshots
    ADD CONSTRAINT plugin_discovery_snapshots_pkey PRIMARY KEY (id);


--
-- Name: plugin_promotion_records plugin_promotion_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_promotion_records
    ADD CONSTRAINT plugin_promotion_records_pkey PRIMARY KEY (id);


--
-- Name: plugin_resource_locks plugin_resource_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_resource_locks
    ADD CONSTRAINT plugin_resource_locks_pkey PRIMARY KEY (id);


--
-- Name: plugin_resource_locks plugin_resource_locks_tenant_id_resource_key_owner_run_id_o_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_resource_locks
    ADD CONSTRAINT plugin_resource_locks_tenant_id_resource_key_owner_run_id_o_key UNIQUE (tenant_id, resource_key, owner_run_id, owner_step_id);


--
-- Name: plugin_runner_cutover_rejections plugin_runner_cutover_rejections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_runner_cutover_rejections
    ADD CONSTRAINT plugin_runner_cutover_rejections_pkey PRIMARY KEY (plugin_version_id);


--
-- Name: plugin_runner_version_bindings plugin_runner_version_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_runner_version_bindings
    ADD CONSTRAINT plugin_runner_version_bindings_pkey PRIMARY KEY (plugin_version_id);


--
-- Name: plugin_workflow_checkpoints plugin_workflow_checkpoints_ledger_id_checkpoint_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_workflow_checkpoints
    ADD CONSTRAINT plugin_workflow_checkpoints_ledger_id_checkpoint_name_key UNIQUE (ledger_id, checkpoint_name);


--
-- Name: plugin_workflow_checkpoints plugin_workflow_checkpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_workflow_checkpoints
    ADD CONSTRAINT plugin_workflow_checkpoints_pkey PRIMARY KEY (id);


--
-- Name: plugin_workflow_ledgers plugin_workflow_ledgers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_workflow_ledgers
    ADD CONSTRAINT plugin_workflow_ledgers_pkey PRIMARY KEY (id);


--
-- Name: plugin_workflow_ledgers plugin_workflow_ledgers_tenant_id_execution_run_id_executio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_workflow_ledgers
    ADD CONSTRAINT plugin_workflow_ledgers_tenant_id_execution_run_id_executio_key UNIQUE (tenant_id, execution_run_id, execution_step_id);


--
-- Name: report_artifacts report_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_artifacts
    ADD CONSTRAINT report_artifacts_pkey PRIMARY KEY (id);


--
-- Name: report_artifacts report_artifacts_tenant_id_storage_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_artifacts
    ADD CONSTRAINT report_artifacts_tenant_id_storage_key_key UNIQUE (tenant_id, storage_key);


--
-- Name: report_runs report_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_runs
    ADD CONSTRAINT report_runs_pkey PRIMARY KEY (id);


--
-- Name: risk_events risk_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_events
    ADD CONSTRAINT risk_events_pkey PRIMARY KEY (id);


--
-- Name: risk_sla_policies risk_sla_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_sla_policies
    ADD CONSTRAINT risk_sla_policies_pkey PRIMARY KEY (id);


--
-- Name: risk_sla_policies risk_sla_policies_tenant_id_version_severity_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_sla_policies
    ADD CONSTRAINT risk_sla_policies_tenant_id_version_severity_key UNIQUE (tenant_id, version, severity);


--
-- Name: risk_status_history risk_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_status_history
    ADD CONSTRAINT risk_status_history_pkey PRIMARY KEY (id);


--
-- Name: rollback_plans rollback_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rollback_plans
    ADD CONSTRAINT rollback_plans_pkey PRIMARY KEY (id);


--
-- Name: service_endpoints service_endpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_endpoints
    ADD CONSTRAINT service_endpoints_pkey PRIMARY KEY (id);


--
-- Name: service_instances service_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_instances
    ADD CONSTRAINT service_instances_pkey PRIMARY KEY (id);


--
-- Name: step_results step_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.step_results
    ADD CONSTRAINT step_results_pkey PRIMARY KEY (id);


--
-- Name: system_initialization_state system_initialization_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_initialization_state
    ADD CONSTRAINT system_initialization_state_pkey PRIMARY KEY (id);


--
-- Name: target_capabilities target_capabilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.target_capabilities
    ADD CONSTRAINT target_capabilities_pkey PRIMARY KEY (id);


--
-- Name: task_attempts task_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_attempts
    ADD CONSTRAINT task_attempts_pkey PRIMARY KEY (id);


--
-- Name: task_attempts task_attempts_task_run_id_attempt_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_attempts
    ADD CONSTRAINT task_attempts_task_run_id_attempt_no_key UNIQUE (task_run_id, attempt_no);


--
-- Name: task_definitions task_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_definitions
    ADD CONSTRAINT task_definitions_pkey PRIMARY KEY (id);


--
-- Name: task_definitions task_definitions_task_type_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_definitions
    ADD CONSTRAINT task_definitions_task_type_version_key UNIQUE (task_type, version);


--
-- Name: task_events task_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_events
    ADD CONSTRAINT task_events_pkey PRIMARY KEY (id);


--
-- Name: task_monitor_probes task_monitor_probes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_monitor_probes
    ADD CONSTRAINT task_monitor_probes_pkey PRIMARY KEY (id);


--
-- Name: task_resource_refs task_resource_refs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_resource_refs
    ADD CONSTRAINT task_resource_refs_pkey PRIMARY KEY (task_run_id, resource_type, resource_id);


--
-- Name: task_runs task_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_runs
    ADD CONSTRAINT task_runs_pkey PRIMARY KEY (id);


--
-- Name: tenant_memberships tenant_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT tenant_memberships_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: unified_plugin_bindings unified_plugin_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unified_plugin_bindings
    ADD CONSTRAINT unified_plugin_bindings_pkey PRIMARY KEY (id);


--
-- Name: unified_plugin_resources unified_plugin_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unified_plugin_resources
    ADD CONSTRAINT unified_plugin_resources_pkey PRIMARY KEY (plugin_version_id, resource_path);


--
-- Name: unified_plugin_versions unified_plugin_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unified_plugin_versions
    ADD CONSTRAINT unified_plugin_versions_pkey PRIMARY KEY (id);


--
-- Name: agents uq_agents_install; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT uq_agents_install UNIQUE (tenant_id, install_id);


--
-- Name: pg_ca_capability_records uq_ca_capability_record; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_capability_records
    ADD CONSTRAINT uq_ca_capability_record UNIQUE (tenant_id, owner_type, owner_id, capability_key);


--
-- Name: pg_ca_external_observations uq_ca_external_observation; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_external_observations
    ADD CONSTRAINT uq_ca_external_observation UNIQUE (tenant_id, provider_id, ca_id, object_type, external_object_id);


--
-- Name: pg_ca_issuance_records uq_ca_issuance_serial; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_issuance_records
    ADD CONSTRAINT uq_ca_issuance_serial UNIQUE (tenant_id, ca_id, serial_number);


--
-- Name: pg_ca_template_mappings uq_ca_template_mapping; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_template_mappings
    ADD CONSTRAINT uq_ca_template_mapping UNIQUE (tenant_id, ca_id, profile_version_id, external_template_id);


--
-- Name: certificate_version_formats uq_certificate_version_formats; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_version_formats
    ADD CONSTRAINT uq_certificate_version_formats UNIQUE (tenant_id, certificate_version_id, format);


--
-- Name: certificate_versions uq_certificate_versions_asset_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_versions
    ADD CONSTRAINT uq_certificate_versions_asset_version UNIQUE (tenant_id, certificate_asset_id, version_no);


--
-- Name: certificate_versions uq_certificate_versions_fingerprint; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_versions
    ADD CONSTRAINT uq_certificate_versions_fingerprint UNIQUE (tenant_id, fingerprint_sha256);


--
-- Name: deployment_input_snapshots uq_deployment_input_snapshots_target_revision; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployment_input_snapshots
    ADD CONSTRAINT uq_deployment_input_snapshots_target_revision UNIQUE (tenant_id, deployment_plan_target_id, revision);


--
-- Name: deployment_plan_targets uq_deployment_plan_targets_binding; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployment_plan_targets
    ADD CONSTRAINT uq_deployment_plan_targets_binding UNIQUE (tenant_id, deployment_plan_id, certificate_binding_id);


--
-- Name: execution_runs uq_execution_runs_external; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_runs
    ADD CONSTRAINT uq_execution_runs_external UNIQUE (tenant_id, external_run_id);


--
-- Name: execution_runs uq_execution_runs_idempotency; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_runs
    ADD CONSTRAINT uq_execution_runs_idempotency UNIQUE (tenant_id, idempotency_key);


--
-- Name: execution_runs uq_execution_runs_plan_run; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_runs
    ADD CONSTRAINT uq_execution_runs_plan_run UNIQUE (tenant_id, deployment_plan_id, run_no);


--
-- Name: execution_steps uq_execution_steps_run_step; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_steps
    ADD CONSTRAINT uq_execution_steps_run_step UNIQUE (tenant_id, execution_run_id, step_no);


--
-- Name: plugin_capability_assignments uq_plugin_capability_assignment; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_capability_assignments
    ADD CONSTRAINT uq_plugin_capability_assignment UNIQUE (tenant_id, owner_type, owner_id, capability_key);


--
-- Name: rollback_plans uq_rollback_plans_run; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rollback_plans
    ADD CONSTRAINT uq_rollback_plans_run UNIQUE (tenant_id, execution_run_id);


--
-- Name: target_capabilities uq_target_capabilities_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.target_capabilities
    ADD CONSTRAINT uq_target_capabilities_key UNIQUE (tenant_id, target_type, target_id, capability_key);


--
-- Name: tenants uq_tenants_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT uq_tenants_code UNIQUE (code);


--
-- Name: unified_plugin_versions uq_unified_plugin_versions_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unified_plugin_versions
    ADD CONSTRAINT uq_unified_plugin_versions_identity UNIQUE (tenant_id, plugin_id, plugin_version);


--
-- Name: unified_plugin_versions uq_unified_plugin_versions_tenant_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unified_plugin_versions
    ADD CONSTRAINT uq_unified_plugin_versions_tenant_id UNIQUE (tenant_id, id);


--
-- Name: workflow_execution_bindings workflow_execution_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_execution_bindings
    ADD CONSTRAINT workflow_execution_bindings_pkey PRIMARY KEY (id);


--
-- Name: workflow_runs workflow_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_pkey PRIMARY KEY (id);


--
-- Name: workflow_templates workflow_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_templates
    ADD CONSTRAINT workflow_templates_pkey PRIMARY KEY (id);


--
-- Name: idx_agents_status_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agents_status_seen ON public.agents USING btree (tenant_id, status, last_seen_at);


--
-- Name: idx_app_documents_namespace_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_documents_namespace_updated ON public.app_documents USING btree (namespace, updated_at DESC);


--
-- Name: idx_application_onboarding_sessions_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_application_onboarding_sessions_expiry ON public.application_onboarding_sessions USING btree (expires_at) WHERE (state <> ALL (ARRAY['PLAN_CREATED'::text, 'CANCELLED'::text]));


--
-- Name: idx_application_onboarding_sessions_tenant_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_application_onboarding_sessions_tenant_updated ON public.application_onboarding_sessions USING btree (tenant_id, updated_at DESC);


--
-- Name: idx_audit_events_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_request ON public.audit_events USING btree (tenant_id, request_id);


--
-- Name: idx_audit_events_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_resource ON public.audit_events USING btree (tenant_id, resource_type, resource_id, created_at DESC);


--
-- Name: idx_automation_action_results_run_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_action_results_run_target ON public.automation_run_action_results USING btree (run_id, run_target_id, action_position);


--
-- Name: idx_automation_definitions_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_definitions_due ON public.automation_definitions USING btree (next_run_at) WHERE (((status)::text = 'active'::text) AND (deleted_at IS NULL));


--
-- Name: idx_automation_definitions_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_definitions_tenant_status ON public.automation_definitions USING btree (tenant_id, status, updated_at DESC);


--
-- Name: idx_automation_run_targets_reporting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_run_targets_reporting ON public.automation_run_targets USING btree (tenant_id, status, failure_stage, finished_at DESC);


--
-- Name: idx_automation_run_targets_run_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_run_targets_run_status ON public.automation_run_targets USING btree (run_id, status, sequence_no);


--
-- Name: idx_automation_runs_automation_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_runs_automation_created ON public.automation_runs USING btree (automation_id, created_at DESC);


--
-- Name: idx_automation_runs_delivery; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_runs_delivery ON public.automation_runs USING btree (tenant_id, delivery_id) WHERE (delivery_id IS NOT NULL);


--
-- Name: idx_automation_runs_reporting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_runs_reporting ON public.automation_runs USING btree (tenant_id, status, failure_stage, finished_at DESC);


--
-- Name: idx_automation_runs_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_runs_tenant_created ON public.automation_runs USING btree (tenant_id, created_at DESC);


--
-- Name: idx_automation_trigger_deliveries_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_trigger_deliveries_run ON public.automation_trigger_deliveries USING btree (run_id) WHERE (run_id IS NOT NULL);


--
-- Name: idx_automation_trigger_deliveries_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_trigger_deliveries_status ON public.automation_trigger_deliveries USING btree (tenant_id, status, created_at DESC);


--
-- Name: idx_automation_versions_tenant_automation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_versions_tenant_automation ON public.automation_versions USING btree (tenant_id, automation_id, version DESC);


--
-- Name: idx_backup_artifacts_binding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_backup_artifacts_binding ON public.backup_artifacts USING btree (tenant_id, certificate_binding_id);


--
-- Name: idx_browser_credential_sessions_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_browser_credential_sessions_expiry ON public.browser_credential_sessions USING btree (expires_at, status);


--
-- Name: idx_browser_credential_sessions_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_browser_credential_sessions_tenant_status ON public.browser_credential_sessions USING btree (tenant_id, status, updated_at DESC);


--
-- Name: idx_business_permission_relations_root; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_permission_relations_root ON public.pg_business_permission_relations USING btree (tenant_id, root_domain, root_object_type, root_object_id);


--
-- Name: idx_business_permission_root; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_permission_root ON public.pg_business_permission_grants USING btree (tenant_id, domain, root_object_type, root_object_id, status);


--
-- Name: idx_business_permission_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_business_permission_subject ON public.pg_business_permission_grants USING btree (tenant_id, principal_type, principal_id, status);


--
-- Name: idx_ca_capability_records_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ca_capability_records_expiry ON public.pg_ca_capability_records USING btree (tenant_id, expires_at) WHERE (expires_at IS NOT NULL);


--
-- Name: idx_ca_capability_records_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ca_capability_records_owner ON public.pg_ca_capability_records USING btree (tenant_id, owner_type, owner_id, state);


--
-- Name: idx_ca_external_observations_list; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ca_external_observations_list ON public.pg_ca_external_observations USING btree (tenant_id, ca_id, object_type, observed_at DESC, id DESC);


--
-- Name: idx_ca_external_observations_serial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ca_external_observations_serial ON public.pg_ca_external_observations USING btree (tenant_id, ca_id, serial_number) WHERE (serial_number IS NOT NULL);


--
-- Name: idx_ca_external_observations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ca_external_observations_status ON public.pg_ca_external_observations USING btree (tenant_id, ca_id, object_type, normalized_status, observed_at DESC, id DESC);


--
-- Name: idx_ca_issuance_ca_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ca_issuance_ca_status ON public.pg_ca_issuance_records USING btree (tenant_id, ca_id, status, created_at DESC);


--
-- Name: idx_ca_issuance_certificate_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ca_issuance_certificate_version ON public.pg_ca_issuance_records USING btree (tenant_id, certificate_version_id) WHERE (certificate_version_id IS NOT NULL);


--
-- Name: idx_ca_issuance_revoked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ca_issuance_revoked ON public.pg_ca_issuance_records USING btree (tenant_id, ca_id, revoked_at DESC) WHERE (status = 'revoked'::text);


--
-- Name: idx_ca_sync_runs_auto_schedule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ca_sync_runs_auto_schedule ON public.pg_ca_sync_runs USING btree (ca_id, object_type, updated_at DESC);


--
-- Name: idx_ca_sync_runs_dispatchable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ca_sync_runs_dispatchable ON public.pg_ca_sync_runs USING btree (status, next_attempt_at, created_at) WHERE (status = 'queued'::text);


--
-- Name: idx_ca_sync_runs_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ca_sync_runs_recent ON public.pg_ca_sync_runs USING btree (tenant_id, ca_id, object_type, created_at DESC);


--
-- Name: idx_ca_sync_runs_recoverable_lease; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ca_sync_runs_recoverable_lease ON public.pg_ca_sync_runs USING btree (lease_expires_at) WHERE ((status = 'running'::text) AND (lease_expires_at IS NOT NULL));


--
-- Name: idx_ca_template_mappings_list; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ca_template_mappings_list ON public.pg_ca_template_mappings USING btree (tenant_id, ca_id, status, updated_at DESC, id DESC);


--
-- Name: idx_certificate_assets_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_certificate_assets_domain ON public.certificate_assets USING btree (tenant_id, primary_domain, environment);


--
-- Name: idx_certificate_assets_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_certificate_assets_tenant_status ON public.certificate_assets USING btree (tenant_id, status);


--
-- Name: idx_certificate_bindings_desired_fp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_certificate_bindings_desired_fp ON public.certificate_bindings USING btree (tenant_id, desired_fingerprint_sha256);


--
-- Name: idx_certificate_bindings_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_certificate_bindings_domain ON public.certificate_bindings USING btree (tenant_id, domain_name);


--
-- Name: idx_certificate_bindings_observed_fp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_certificate_bindings_observed_fp ON public.certificate_bindings USING btree (tenant_id, observed_fingerprint_sha256);


--
-- Name: idx_certificate_bindings_status_verified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_certificate_bindings_status_verified ON public.certificate_bindings USING btree (tenant_id, status, last_verified_at);


--
-- Name: idx_certificate_observations_fp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_certificate_observations_fp ON public.certificate_observations USING btree (tenant_id, fingerprint_sha256);


--
-- Name: idx_certificate_observations_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_certificate_observations_time ON public.certificate_observations USING btree (tenant_id, observed_at DESC);


--
-- Name: idx_certificate_versions_issuer_serial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_certificate_versions_issuer_serial ON public.certificate_versions USING btree (tenant_id, issuer, serial_number);


--
-- Name: idx_certificate_versions_not_after; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_certificate_versions_not_after ON public.certificate_versions USING btree (tenant_id, not_after);


--
-- Name: idx_certificate_versions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_certificate_versions_status ON public.certificate_versions USING btree (tenant_id, status);


--
-- Name: idx_cloud_account_assets_provider_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cloud_account_assets_provider_status ON public.pg_cloud_account_assets USING btree (tenant_id, provider_key, status, updated_at DESC);


--
-- Name: idx_credential_profiles_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credential_profiles_scope ON public.credential_profiles USING btree (tenant_id, scope_type, scope_id);


--
-- Name: idx_credential_profiles_tenant_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credential_profiles_tenant_expires_at ON public.credential_profiles USING btree (tenant_id, expires_at);


--
-- Name: idx_credential_profiles_tenant_status_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credential_profiles_tenant_status_kind ON public.credential_profiles USING btree (tenant_id, status, kind);


--
-- Name: idx_deployment_input_snapshots_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deployment_input_snapshots_plan ON public.deployment_input_snapshots USING btree (tenant_id, deployment_plan_id, revision, created_at);


--
-- Name: idx_deployment_plan_targets_binding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deployment_plan_targets_binding ON public.deployment_plan_targets USING btree (tenant_id, certificate_binding_id);


--
-- Name: idx_deployment_plans_status_schedule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deployment_plans_status_schedule ON public.deployment_plans USING btree (tenant_id, status, scheduled_at);


--
-- Name: idx_device_liveness_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_liveness_resource ON public.pg_device_liveness_signals USING btree (tenant_id, resource_type, resource_id);


--
-- Name: idx_device_liveness_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_liveness_status ON public.pg_device_liveness_signals USING btree (tenant_id, signal_type, status, updated_at);


--
-- Name: idx_execution_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_runs_status ON public.execution_runs USING btree (tenant_id, status, created_at DESC);


--
-- Name: idx_execution_steps_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_steps_status ON public.execution_steps USING btree (tenant_id, execution_run_id, status);


--
-- Name: idx_execution_targets_kind_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_targets_kind_status ON public.execution_targets USING btree (tenant_id, target_kind, status);


--
-- Name: idx_gateways_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gateways_status ON public.gateways USING btree (tenant_id, status);


--
-- Name: idx_hosts_compatibility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hosts_compatibility ON public.hosts USING btree (tenant_id, compatibility_level, management_mode);


--
-- Name: idx_hosts_hostname; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hosts_hostname ON public.hosts USING btree (tenant_id, hostname);


--
-- Name: idx_hosts_primary_ip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hosts_primary_ip ON public.hosts USING btree (tenant_id, primary_ip);


--
-- Name: idx_hosts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hosts_status ON public.hosts USING btree (tenant_id, status);


--
-- Name: idx_idempotency_records_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_idempotency_records_expiry ON public.idempotency_records USING btree (expires_at);


--
-- Name: idx_idempotency_records_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_idempotency_records_lookup ON public.idempotency_records USING btree (tenant_id, action_type, resource_type, resource_id, idempotency_key);


--
-- Name: idx_job_queue_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_job_queue_idempotency_key ON public.job_queue USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: idx_job_queue_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_queue_status_created ON public.job_queue USING btree (status, created_at);


--
-- Name: idx_metric_snapshots_query; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metric_snapshots_query ON public.metric_snapshots USING btree (tenant_id, metric_key, metric_version, snapshot_date);


--
-- Name: idx_monitor_targets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_monitor_targets_status ON public.monitor_targets USING btree (tenant_id, status);


--
-- Name: idx_notification_channels_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_channels_tenant_status ON public.notification_channels USING btree (tenant_id, status, updated_at DESC);


--
-- Name: idx_notification_deliveries_query; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_deliveries_query ON public.notification_deliveries USING btree (tenant_id, request_id, channel_id, status, created_at DESC);


--
-- Name: idx_notification_deliveries_worker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_deliveries_worker ON public.notification_deliveries USING btree (status, next_attempt_at, lease_until, created_at);


--
-- Name: idx_notification_delivery_attempts_delivery; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_delivery_attempts_delivery ON public.notification_delivery_attempts USING btree (delivery_id, attempt_no DESC);


--
-- Name: idx_notification_requests_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_requests_event ON public.notification_requests USING btree (tenant_id, event_key, created_at DESC);


--
-- Name: idx_notification_requests_query; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_requests_query ON public.notification_requests USING btree (tenant_id, status, source, created_at DESC);


--
-- Name: idx_notification_routes_match; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_routes_match ON public.notification_routes USING btree (tenant_id, status, priority, created_at);


--
-- Name: idx_notification_silences_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_silences_active ON public.notification_silences USING btree (tenant_id, status, starts_at, ends_at);


--
-- Name: idx_notification_templates_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_templates_lookup ON public.notification_templates USING btree (tenant_id, template_key, locale, status);


--
-- Name: idx_obj_perm_bindings_principal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_obj_perm_bindings_principal ON public.object_permission_role_bindings USING btree (principal_type, principal_id, tenant_id, enabled);


--
-- Name: idx_obj_perm_grants_role_set; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_obj_perm_grants_role_set ON public.object_permission_access_grants USING btree (role_id, object_set_id, access_level, effect);


--
-- Name: idx_obj_perm_groups_external_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_obj_perm_groups_external_source ON public.object_permission_groups USING btree (tenant_id, external_source_id, external_ref);


--
-- Name: idx_obj_perm_groups_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_obj_perm_groups_tenant ON public.object_permission_groups USING btree (tenant_id, enabled);


--
-- Name: idx_obj_perm_members_object; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_obj_perm_members_object ON public.object_permission_object_set_members USING btree (object_type, object_id);


--
-- Name: idx_obj_perm_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_obj_perm_members_user ON public.object_permission_group_members USING btree (user_id);


--
-- Name: idx_obj_perm_sets_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_obj_perm_sets_tenant ON public.object_permission_object_sets USING btree (tenant_id, status);


--
-- Name: idx_pg_acme_accounts_eab_secret; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_acme_accounts_eab_secret ON public.pg_acme_accounts USING btree (tenant_id, eab_secret_ref) WHERE (eab_secret_ref IS NOT NULL);


--
-- Name: idx_pg_acme_accounts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_acme_accounts_status ON public.pg_acme_accounts USING btree (tenant_id, provider_id, status, updated_at DESC);


--
-- Name: idx_pg_acme_authorizations_order_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_acme_authorizations_order_status ON public.pg_acme_authorizations USING btree (tenant_id, order_id, status);


--
-- Name: idx_pg_acme_challenges_lease; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_acme_challenges_lease ON public.pg_acme_challenges USING btree (tenant_id, status, lease_expires_at, updated_at);


--
-- Name: idx_pg_acme_http01_presentations_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_acme_http01_presentations_expiry ON public.pg_acme_http01_presentations USING btree (expires_at);


--
-- Name: idx_pg_acme_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_acme_orders_status ON public.pg_acme_orders USING btree (tenant_id, status, retry_after_at, updated_at);


--
-- Name: idx_pg_acme_plugin_challenges_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_acme_plugin_challenges_request ON public.pg_acme_plugin_challenges USING btree (request_id, status, updated_at);


--
-- Name: idx_pg_acme_plugin_operations_audit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_acme_plugin_operations_audit ON public.pg_acme_plugin_operations USING btree (tenant_id, request_id, status, updated_at DESC);


--
-- Name: idx_pg_acme_plugin_operations_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_acme_plugin_operations_request ON public.pg_acme_plugin_operations USING btree (request_id, updated_at DESC);


--
-- Name: idx_pg_acme_plugin_requests_audit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_acme_plugin_requests_audit ON public.pg_acme_plugin_requests USING btree (tenant_id, status, updated_at DESC);


--
-- Name: idx_pg_acme_plugin_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_acme_plugin_requests_status ON public.pg_acme_plugin_requests USING btree (tenant_id, status, retry_after_at, updated_at DESC);


--
-- Name: idx_pg_acme_renewal_policies_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_acme_renewal_policies_due ON public.pg_acme_renewal_policies USING btree (tenant_id, enabled, status, updated_at);


--
-- Name: idx_pg_agent_snapshot_current_latest_full_web; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_agent_snapshot_current_latest_full_web ON public.pg_agent_capability_snapshot_current USING btree (tenant_id, latest_full_web_reported_at DESC) WHERE (latest_full_web_snapshot_id IS NOT NULL);


--
-- Name: idx_pg_agent_snapshot_retention_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_agent_snapshot_retention_runs_status ON public.pg_agent_snapshot_retention_runs USING btree (status, updated_at DESC);


--
-- Name: idx_pg_application_asset_targets_managed_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_application_asset_targets_managed_target ON public.pg_application_asset_targets USING btree (tenant_id, managed_target_id);


--
-- Name: idx_pg_application_asset_targets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_application_asset_targets_status ON public.pg_application_asset_targets USING btree (tenant_id, status);


--
-- Name: idx_pg_asset_conflicts_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_asset_conflicts_tenant_status ON public.pg_asset_conflicts USING btree (tenant_id, status);


--
-- Name: idx_pg_ca_authorities_trust_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_ca_authorities_trust_domain ON public.pg_certificate_authorities USING btree (tenant_id, trust_domain_id, status);


--
-- Name: idx_pg_ca_node_request_nonces_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_ca_node_request_nonces_expiry ON public.pg_ca_node_request_nonces USING btree (expires_at);


--
-- Name: idx_pg_ca_node_tasks_lease; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_ca_node_tasks_lease ON public.pg_ca_node_tasks USING btree (provider_id, status, created_at);


--
-- Name: idx_pg_ca_nodes_provider_health; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_ca_nodes_provider_health ON public.pg_ca_nodes USING btree (provider_id, health_status, last_heartbeat_at DESC);


--
-- Name: idx_pg_ca_profiles_trust_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_ca_profiles_trust_domain ON public.pg_certificate_profiles USING btree (tenant_id, trust_domain_id, status);


--
-- Name: idx_pg_ca_providers_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_ca_providers_tenant_status ON public.pg_ca_providers USING btree (tenant_id, status);


--
-- Name: idx_pg_ca_requests_trust_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_ca_requests_trust_domain ON public.pg_certificate_requests USING btree (tenant_id, trust_domain_id, created_at DESC);


--
-- Name: idx_pg_certificate_artifacts_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_artifacts_created_at ON public.pg_certificate_artifacts USING btree (created_at DESC);


--
-- Name: idx_pg_certificate_artifacts_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_artifacts_tenant_created ON public.pg_certificate_artifacts USING btree (tenant_id, created_at DESC);


--
-- Name: idx_pg_certificate_assets_primary_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_assets_primary_domain ON public.pg_certificate_assets USING btree (primary_domain);


--
-- Name: idx_pg_certificate_assets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_assets_status ON public.pg_certificate_assets USING btree (status);


--
-- Name: idx_pg_certificate_assets_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_assets_tenant_status ON public.pg_certificate_assets USING btree (tenant_id, status, created_at DESC);


--
-- Name: idx_pg_certificate_authorities_provider_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_authorities_provider_status ON public.pg_certificate_authorities USING btree (provider_id, status);


--
-- Name: idx_pg_certificate_bindings_dashboard_managed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_bindings_dashboard_managed ON public.pg_certificate_bindings USING btree (tenant_id, status, updated_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_pg_certificate_bindings_desired_fp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_bindings_desired_fp ON public.pg_certificate_bindings USING btree (tenant_id, desired_fingerprint_sha256);


--
-- Name: idx_pg_certificate_bindings_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_bindings_domain ON public.pg_certificate_bindings USING btree (tenant_id, domain_name);


--
-- Name: idx_pg_certificate_bindings_managed_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_bindings_managed_target ON public.pg_certificate_bindings USING btree (tenant_id, managed_target_id);


--
-- Name: idx_pg_certificate_bindings_observed_fp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_bindings_observed_fp ON public.pg_certificate_bindings USING btree (tenant_id, observed_fingerprint_sha256);


--
-- Name: idx_pg_certificate_bindings_service_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_bindings_service_asset ON public.pg_certificate_bindings USING btree (tenant_id, service_asset_id);


--
-- Name: idx_pg_certificate_bindings_site_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_bindings_site_asset ON public.pg_certificate_bindings USING btree (tenant_id, site_asset_id);


--
-- Name: idx_pg_certificate_bindings_status_verified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_bindings_status_verified ON public.pg_certificate_bindings USING btree (tenant_id, status, last_verified_at);


--
-- Name: idx_pg_certificate_renewal_jobs_lease; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_renewal_jobs_lease ON public.pg_certificate_renewal_jobs USING btree (tenant_id, status, next_attempt_at, lease_expires_at, scheduled_at);


--
-- Name: idx_pg_certificate_requests_public_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_requests_public_key ON public.pg_certificate_requests USING btree (tenant_id, public_key_fingerprint_sha256);


--
-- Name: idx_pg_certificate_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_requests_status ON public.pg_certificate_requests USING btree (tenant_id, status, created_at DESC);


--
-- Name: idx_pg_certificate_version_formats_tenant_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_version_formats_tenant_version ON public.pg_certificate_version_formats USING btree (tenant_id, certificate_version_id, created_at DESC);


--
-- Name: idx_pg_certificate_version_formats_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_version_formats_version ON public.pg_certificate_version_formats USING btree (certificate_version_id, created_at DESC);


--
-- Name: idx_pg_certificate_version_trust_roots_root; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_version_trust_roots_root ON public.pg_certificate_version_trust_roots USING btree (tenant_id, root_certificate_id, created_at DESC);


--
-- Name: idx_pg_certificate_version_trust_roots_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_version_trust_roots_version ON public.pg_certificate_version_trust_roots USING btree (tenant_id, certificate_version_id, created_at DESC);


--
-- Name: idx_pg_certificate_versions_activation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_versions_activation ON public.pg_certificate_versions USING btree (tenant_id, certificate_asset_id, activation_state, not_after DESC);


--
-- Name: idx_pg_certificate_versions_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_versions_asset ON public.pg_certificate_versions USING btree (certificate_asset_id, status);


--
-- Name: idx_pg_certificate_versions_dashboard_active_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_versions_dashboard_active_expiry ON public.pg_certificate_versions USING btree (tenant_id, not_after, certificate_asset_id) WHERE ((status)::text = 'active'::text);


--
-- Name: idx_pg_certificate_versions_not_after; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_versions_not_after ON public.pg_certificate_versions USING btree (not_after);


--
-- Name: idx_pg_certificate_versions_public_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_versions_public_key ON public.pg_certificate_versions USING btree (public_key_fingerprint_sha256) WHERE (public_key_fingerprint_sha256 IS NOT NULL);


--
-- Name: idx_pg_certificate_versions_tenant_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_versions_tenant_asset ON public.pg_certificate_versions USING btree (tenant_id, certificate_asset_id, status, created_at DESC);


--
-- Name: idx_pg_certificate_versions_tenant_not_after; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_versions_tenant_not_after ON public.pg_certificate_versions USING btree (tenant_id, not_after);


--
-- Name: idx_pg_certificate_versions_trust_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_certificate_versions_trust_domain ON public.pg_certificate_versions USING btree (trust_domain_id, status);


--
-- Name: idx_pg_data_correction_batches_spec_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_data_correction_batches_spec_status ON public.pg_data_correction_batches USING btree (spec_id, status, started_at DESC);


--
-- Name: idx_pg_device_assets_family; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_device_assets_family ON public.pg_device_assets USING btree (tenant_id, device_family);


--
-- Name: idx_pg_device_assets_host; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_device_assets_host ON public.pg_device_assets USING btree (tenant_id, host_id);


--
-- Name: idx_pg_device_certificate_bindings_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_device_certificate_bindings_target ON public.pg_device_certificate_bindings USING btree (tenant_id, virtual_server_id);


--
-- Name: idx_pg_device_virtual_servers_device; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_device_virtual_servers_device ON public.pg_device_virtual_servers USING btree (tenant_id, device_asset_id, status);


--
-- Name: idx_pg_discovery_snapshots_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_discovery_snapshots_tenant ON public.pg_discovery_snapshots USING btree (tenant_id, created_at DESC);


--
-- Name: idx_pg_documents_agent_heartbeats_detail; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_agent_heartbeats_detail ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), ((payload ->> 'agentId'::text)), ((payload ->> 'receivedAt'::text)) DESC) WHERE ((namespace)::text = 'agents:heartbeats'::text);


--
-- Name: idx_pg_documents_agent_runtime_logs_detail; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_agent_runtime_logs_detail ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), ((payload ->> 'agentId'::text)), ((payload ->> 'emittedAt'::text)) DESC) WHERE ((namespace)::text = 'agents:runtimeLogs'::text);


--
-- Name: idx_pg_documents_agent_snapshots_detail; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_agent_snapshots_detail ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), ((payload ->> 'agentId'::text)), ((payload ->> 'reportedAt'::text)) DESC) WHERE ((namespace)::text = 'agents:snapshots'::text);


--
-- Name: idx_pg_documents_agent_task_logs_by_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_agent_task_logs_by_task ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), ((payload ->> 'taskId'::text)), ((payload ->> 'emittedAt'::text)), ((payload ->> 'sequence'::text))) WHERE ((namespace)::text = 'agents:taskLogs'::text);


--
-- Name: idx_pg_documents_agent_task_logs_detail; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_agent_task_logs_detail ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), ((payload ->> 'agentId'::text)), ((payload ->> 'emittedAt'::text)) DESC, ((payload ->> 'sequence'::text))) WHERE ((namespace)::text = 'agents:taskLogs'::text);


--
-- Name: idx_pg_documents_agent_tasks_detail; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_agent_tasks_detail ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), ((payload ->> 'agentId'::text)), ((payload ->> 'createdAt'::text))) WHERE ((namespace)::text = 'agents:tasks'::text);


--
-- Name: idx_pg_documents_agent_tasks_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_agent_tasks_idempotency ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), ((payload ->> 'agentId'::text)), ((payload ->> 'idempotencyKey'::text)), ((payload ->> 'createdAt'::text))) WHERE ((namespace)::text = 'agents:tasks'::text);


--
-- Name: idx_pg_documents_audit_logs_resource_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_audit_logs_resource_type ON public.pg_documents USING btree (namespace, ((payload ->> 'resourceType'::text)), ((payload ->> 'resourceId'::text))) WHERE ((namespace)::text = 'security.audit_logs'::text);


--
-- Name: idx_pg_documents_audit_logs_tenant_actor_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_audit_logs_tenant_actor_event ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), ((payload ->> 'actorId'::text)), ((payload ->> 'eventType'::text)), updated_at) WHERE ((namespace)::text = 'security.audit_logs'::text);


--
-- Name: idx_pg_documents_dashboard_agents; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_dashboard_agents ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), ((payload ->> 'status'::text)), updated_at DESC) WHERE ((namespace)::text = 'agents:registrations'::text);


--
-- Name: idx_pg_documents_dashboard_audits; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_dashboard_audits ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), updated_at DESC) WHERE ((namespace)::text = 'security.audit_logs'::text);


--
-- Name: idx_pg_documents_deployment_plans_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_deployment_plans_idempotency ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), ((payload ->> 'createdBy'::text)), ((payload ->> 'idempotencyKey'::text)), updated_at) WHERE ((namespace)::text = 'deployment-plans:plans'::text);


--
-- Name: idx_pg_documents_deployment_plans_tenant_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_deployment_plans_tenant_updated ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), updated_at) WHERE ((namespace)::text = 'deployment-plans:plans'::text);


--
-- Name: idx_pg_documents_deployment_targets_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_deployment_targets_asset ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), ((payload ->> 'applicationAssetId'::text)), ((payload ->> 'deploymentPlanId'::text))) WHERE ((namespace)::text = 'deployment-plans:targets'::text);


--
-- Name: idx_pg_documents_deployment_targets_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_deployment_targets_plan ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), ((payload ->> 'deploymentPlanId'::text)), updated_at) WHERE ((namespace)::text = 'deployment-plans:targets'::text);


--
-- Name: idx_pg_documents_deployment_transitions_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_deployment_transitions_entity ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), ((payload ->> 'entityId'::text)), updated_at) WHERE ((namespace)::text = 'deployment-plans:transitions'::text);


--
-- Name: idx_pg_documents_device_detail_audits; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_device_detail_audits ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), ((payload ->> 'resourceId'::text)), ((payload ->> 'createdAt'::text)) DESC) WHERE ((namespace)::text = 'security.audit_logs'::text);


--
-- Name: idx_pg_documents_device_detail_legacy_audits; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_device_detail_legacy_audits ON public.pg_documents USING btree (namespace, ((payload ->> 'resourceId'::text)), ((payload ->> 'createdAt'::text)) DESC) WHERE (((namespace)::text = 'security.audit_logs'::text) AND ((payload ->> 'tenantId'::text) IS NULL));


--
-- Name: idx_pg_documents_execution_runs_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_execution_runs_idempotency ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), ((payload ->> 'idempotencyKey'::text)), ((payload ->> 'createdAt'::text))) WHERE ((namespace)::text = 'executions:runs'::text);


--
-- Name: idx_pg_documents_execution_runs_plan_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_execution_runs_plan_created ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), ((payload ->> 'deploymentPlanId'::text)), ((payload ->> 'createdAt'::text))) WHERE ((namespace)::text = 'executions:runs'::text);


--
-- Name: idx_pg_documents_execution_steps_run_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_execution_steps_run_order ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), ((payload ->> 'executionRunId'::text)), (((payload ->> 'stepNo'::text))::integer), ((payload ->> 'createdAt'::text))) WHERE ((namespace)::text = 'executions:steps'::text);


--
-- Name: idx_pg_documents_gateway_history_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_gateway_history_target ON public.pg_documents USING btree (namespace, ((payload ->> 'tenantId'::text)), ((payload ->> 'delegatedTargetId'::text)), ((payload ->> 'createdAt'::text))) WHERE ((namespace)::text = 'gateway-target-history'::text);


--
-- Name: idx_pg_documents_gateway_history_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_gateway_history_task ON public.pg_documents USING btree (namespace, ((payload ->> 'taskId'::text)), ((payload ->> 'createdAt'::text))) WHERE ((namespace)::text = 'gateway-target-history'::text);


--
-- Name: idx_pg_documents_licensing_namespace_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_licensing_namespace_updated ON public.pg_documents USING btree (namespace, updated_at DESC) WHERE ((namespace)::text ~~ 'licensing.%'::text);


--
-- Name: idx_pg_documents_namespace_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_namespace_updated ON public.pg_documents USING btree (namespace, updated_at DESC);


--
-- Name: idx_pg_documents_security_users_preferences; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_documents_security_users_preferences ON public.pg_documents USING btree (((payload -> 'preferences'::text))) WHERE ((namespace)::text = 'security.users'::text);


--
-- Name: idx_pg_execution_runs_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_pg_execution_runs_idempotency ON public.pg_execution_runs USING btree (COALESCE(tenant_id, ''::character varying), idempotency_key);


--
-- Name: idx_pg_execution_runs_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_execution_runs_plan ON public.pg_execution_runs USING btree (COALESCE(tenant_id, ''::character varying), deployment_plan_id, created_at);


--
-- Name: idx_pg_execution_steps_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_execution_steps_run ON public.pg_execution_steps USING btree (COALESCE(tenant_id, ''::character varying), execution_run_id, step_no);


--
-- Name: idx_pg_execution_steps_run_stepno; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_pg_execution_steps_run_stepno ON public.pg_execution_steps USING btree (COALESCE(tenant_id, ''::character varying), execution_run_id, step_no);


--
-- Name: idx_pg_framework_instances_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_framework_instances_asset ON public.pg_framework_instances USING btree (tenant_id, asset_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_pg_framework_instances_correction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_framework_instances_correction ON public.pg_framework_instances USING btree (tenant_id, device_id, discovery_provider_key, framework_key) WHERE (deleted_at IS NULL);


--
-- Name: idx_pg_gateway_reachability_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_pg_gateway_reachability_unique ON public.pg_gateway_reachability USING btree (tenant_id, gateway_id, target_id, protocol);


--
-- Name: idx_pg_gateways_tenant_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_pg_gateways_tenant_agent ON public.pg_gateways USING btree (tenant_id, agent_id);


--
-- Name: idx_pg_gateways_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_gateways_tenant_status ON public.pg_gateways USING btree (tenant_id, status, updated_at DESC);


--
-- Name: idx_pg_hosts_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_hosts_tenant_status ON public.pg_hosts USING btree (tenant_id, status);


--
-- Name: idx_pg_key_references_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_key_references_owner ON public.pg_key_references USING btree (tenant_id, owner_type, owner_id, status);


--
-- Name: idx_pg_key_references_public_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_key_references_public_key ON public.pg_key_references USING btree (tenant_id, public_key_fingerprint_sha256, status);


--
-- Name: idx_pg_managed_target_snapshots_application_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_managed_target_snapshots_application_asset ON public.pg_managed_target_snapshots USING btree (tenant_id, application_asset_id, captured_at DESC);


--
-- Name: idx_pg_managed_target_snapshots_execution_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_managed_target_snapshots_execution_run ON public.pg_managed_target_snapshots USING btree (tenant_id, execution_run_id, captured_at DESC);


--
-- Name: idx_pg_managed_target_snapshots_managed_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_managed_target_snapshots_managed_target ON public.pg_managed_target_snapshots USING btree (tenant_id, managed_target_id, captured_at DESC);


--
-- Name: idx_pg_managed_targets_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_managed_targets_asset ON public.pg_managed_targets USING btree (tenant_id, asset_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_pg_managed_targets_correction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_managed_targets_correction ON public.pg_managed_targets USING btree (tenant_id, device_id, framework_instance_id, site_id, target_key) WHERE (deleted_at IS NULL);


--
-- Name: idx_pg_managed_targets_device; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_managed_targets_device ON public.pg_managed_targets USING btree (tenant_id, device_asset_id);


--
-- Name: idx_pg_managed_targets_host; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_managed_targets_host ON public.pg_managed_targets USING btree (tenant_id, device_id);


--
-- Name: idx_pg_managed_targets_service_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_managed_targets_service_asset ON public.pg_managed_targets USING btree (tenant_id, service_asset_id);


--
-- Name: idx_pg_managed_targets_service_instance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_managed_targets_service_instance ON public.pg_managed_targets USING btree (tenant_id, framework_instance_id);


--
-- Name: idx_pg_managed_targets_site_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_managed_targets_site_asset ON public.pg_managed_targets USING btree (tenant_id, site_id);


--
-- Name: idx_pg_managed_targets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_managed_targets_status ON public.pg_managed_targets USING btree (tenant_id, status);


--
-- Name: idx_pg_monitor_alert_rules_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_monitor_alert_rules_tenant_status ON public.pg_monitor_alert_rules USING btree (tenant_id, status, created_at DESC);


--
-- Name: idx_pg_monitor_certificate_observations_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_monitor_certificate_observations_asset ON public.pg_monitor_certificate_observations USING btree (tenant_id, service_asset_id, observed_at DESC);


--
-- Name: idx_pg_monitor_probe_results_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_monitor_probe_results_asset ON public.pg_monitor_probe_results USING btree (tenant_id, service_asset_id, checked_at DESC);


--
-- Name: idx_pg_monitor_probe_results_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_monitor_probe_results_target ON public.pg_monitor_probe_results USING btree (tenant_id, monitor_target_id, checked_at DESC);


--
-- Name: idx_pg_monitor_risk_events_view; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_monitor_risk_events_view ON public.pg_monitor_risk_events USING btree (tenant_id, status, severity, last_detected_at DESC);


--
-- Name: idx_pg_monitor_scheduler_windows_recovery; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_monitor_scheduler_windows_recovery ON public.pg_monitor_scheduler_windows USING btree (status, updated_at) WHERE (task_id IS NULL);


--
-- Name: idx_pg_monitor_targets_due_scheduler; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_monitor_targets_due_scheduler ON public.pg_monitor_targets USING btree (next_run_at, tenant_id, id) WHERE ((deleted_at IS NULL) AND (status = 'active'::text));


--
-- Name: idx_pg_monitor_targets_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_monitor_targets_tenant_status ON public.pg_monitor_targets USING btree (tenant_id, status, updated_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_pg_root_certificate_source_observations_root; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_root_certificate_source_observations_root ON public.pg_root_certificate_source_observations USING btree (root_certificate_id, observed_at DESC);


--
-- Name: idx_pg_service_assets_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_service_assets_agent ON public.pg_service_assets USING btree (tenant_id, agent_id);


--
-- Name: idx_pg_service_assets_asset_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_service_assets_asset_kind ON public.pg_service_assets USING btree (tenant_id, asset_kind, status) WHERE (deleted_at IS NULL);


--
-- Name: idx_pg_service_assets_dashboard_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_service_assets_dashboard_status ON public.pg_service_assets USING btree (tenant_id, status, updated_at DESC) WHERE ((deleted_at IS NULL) AND ((asset_kind)::text <> 'DEVICE'::text));


--
-- Name: idx_pg_service_assets_host; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_service_assets_host ON public.pg_service_assets USING btree (tenant_id, host_id);


--
-- Name: idx_pg_service_assets_service_endpoint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_service_assets_service_endpoint ON public.pg_service_assets USING btree (tenant_id, service_endpoint_id);


--
-- Name: idx_pg_service_assets_service_instance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_service_assets_service_instance ON public.pg_service_assets USING btree (tenant_id, service_instance_id);


--
-- Name: idx_pg_service_assets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_service_assets_status ON public.pg_service_assets USING btree (tenant_id, status);


--
-- Name: idx_pg_service_endpoints_host_port; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_service_endpoints_host_port ON public.pg_service_endpoints USING btree (tenant_id, host_name, port);


--
-- Name: idx_pg_service_endpoints_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_service_endpoints_status ON public.pg_service_endpoints USING btree (tenant_id, status);


--
-- Name: idx_pg_service_instances_host_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_service_instances_host_provider ON public.pg_framework_instances USING btree (tenant_id, device_id, discovery_provider_key);


--
-- Name: idx_pg_service_instances_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_service_instances_status ON public.pg_framework_instances USING btree (tenant_id, status);


--
-- Name: idx_pg_site_assets_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_site_assets_agent ON public.pg_site_assets USING btree (tenant_id, agent_id);


--
-- Name: idx_pg_site_assets_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_site_assets_asset ON public.pg_site_assets USING btree (tenant_id, asset_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_pg_site_assets_correction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_site_assets_correction ON public.pg_site_assets USING btree (tenant_id, device_id, framework_instance_id, site_key) WHERE (deleted_at IS NULL);


--
-- Name: idx_pg_site_assets_host; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_site_assets_host ON public.pg_site_assets USING btree (tenant_id, device_id);


--
-- Name: idx_pg_site_assets_service_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_site_assets_service_asset ON public.pg_site_assets USING btree (tenant_id, service_asset_id);


--
-- Name: idx_pg_site_assets_service_instance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_site_assets_service_instance ON public.pg_site_assets USING btree (tenant_id, framework_instance_id);


--
-- Name: idx_pg_site_assets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pg_site_assets_status ON public.pg_site_assets USING btree (tenant_id, status);


--
-- Name: idx_plugin_capability_assignments_cloud_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plugin_capability_assignments_cloud_asset ON public.plugin_capability_assignments USING btree (tenant_id, owner_id, capability_key, status) WHERE ((owner_type)::text = 'CLOUD_ACCOUNT_ASSET'::text);


--
-- Name: idx_plugin_capability_assignments_resolve; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plugin_capability_assignments_resolve ON public.plugin_capability_assignments USING btree (tenant_id, capability_key, status, owner_type, owner_id);


--
-- Name: idx_plugin_discovered_bindings_drift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plugin_discovered_bindings_drift ON public.plugin_discovered_certificate_bindings USING btree (tenant_id, device_asset_id, drift_state);


--
-- Name: idx_plugin_discovered_bindings_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plugin_discovered_bindings_target ON public.plugin_discovered_certificate_bindings USING btree (tenant_id, managed_target_id);


--
-- Name: idx_plugin_discovered_certificates_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plugin_discovered_certificates_version ON public.plugin_discovered_certificates USING btree (tenant_id, certificate_version_id);


--
-- Name: idx_plugin_discovery_snapshots_device; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plugin_discovery_snapshots_device ON public.plugin_discovery_snapshots USING btree (tenant_id, device_asset_id, created_at DESC);


--
-- Name: idx_plugin_discovery_snapshots_standard_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plugin_discovery_snapshots_standard_identity ON public.plugin_discovery_snapshots USING btree (tenant_id, device_id, discovery_provider_key, normalized_sha256, status, created_at DESC);


--
-- Name: idx_plugin_promotion_records_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plugin_promotion_records_tenant_status ON public.plugin_promotion_records USING btree (tenant_id, status, updated_at DESC);


--
-- Name: idx_plugin_resource_locks_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plugin_resource_locks_active ON public.plugin_resource_locks USING btree (tenant_id, resource_key, expires_at);


--
-- Name: idx_plugin_runner_version_bindings_canonical; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plugin_runner_version_bindings_canonical ON public.plugin_runner_version_bindings USING btree (canonical_plugin_id, execution_mode);


--
-- Name: idx_plugin_runner_version_bindings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plugin_runner_version_bindings_tenant ON public.plugin_runner_version_bindings USING btree (tenant_id, canonical_plugin_id, plugin_version_id);


--
-- Name: idx_plugin_workflow_checkpoints_ledger; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plugin_workflow_checkpoints_ledger ON public.plugin_workflow_checkpoints USING btree (tenant_id, ledger_id, created_at);


--
-- Name: idx_plugin_workflow_ledgers_recovery; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plugin_workflow_ledgers_recovery ON public.plugin_workflow_ledgers USING btree (tenant_id, status, recovery_classification, updated_at);


--
-- Name: idx_report_runs_list; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_runs_list ON public.report_runs USING btree (tenant_id, created_at DESC);


--
-- Name: idx_risk_events_view; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_risk_events_view ON public.risk_events USING btree (tenant_id, status, severity, detected_at DESC);


--
-- Name: idx_risk_sla_policies_effective; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_risk_sla_policies_effective ON public.risk_sla_policies USING btree (tenant_id, effective_from DESC, effective_to);


--
-- Name: idx_risk_status_history_action_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_risk_status_history_action_time ON public.risk_status_history USING btree (tenant_id, action, occurred_at DESC);


--
-- Name: idx_risk_status_history_event_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_risk_status_history_event_time ON public.risk_status_history USING btree (tenant_id, risk_event_id, occurred_at, id);


--
-- Name: idx_service_assets_execution_mode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_assets_execution_mode ON public.pg_service_assets USING btree ((((metadata -> 'deploymentStrategy'::text) ->> 'type'::text)), ((((metadata -> 'deploymentStrategy'::text) -> 'managedTarget'::text) ->> 'executionMode'::text))) WHERE (deleted_at IS NULL);


--
-- Name: idx_service_endpoints_host_port; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_endpoints_host_port ON public.service_endpoints USING btree (tenant_id, host_name, port);


--
-- Name: idx_service_instances_host_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_instances_host_provider ON public.service_instances USING btree (tenant_id, host_id, provider_type);


--
-- Name: idx_service_instances_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_instances_status ON public.service_instances USING btree (tenant_id, status);


--
-- Name: idx_step_results_step_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_step_results_step_created ON public.step_results USING btree (tenant_id, execution_step_id, created_at);


--
-- Name: idx_target_capabilities_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_target_capabilities_lookup ON public.target_capabilities USING btree (tenant_id, target_type, target_id, capability_key);


--
-- Name: idx_task_attempts_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_attempts_task ON public.task_attempts USING btree (task_run_id, attempt_no DESC);


--
-- Name: idx_task_events_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_events_task ON public.task_events USING btree (task_run_id, created_at);


--
-- Name: idx_task_monitor_probes_query; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_monitor_probes_query ON public.task_monitor_probes USING btree (tenant_id, service_asset_id, checked_at DESC);


--
-- Name: idx_task_resource_refs_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_resource_refs_resource ON public.task_resource_refs USING btree (resource_type, resource_id);


--
-- Name: idx_task_runs_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_runs_parent ON public.task_runs USING btree (parent_task_id);


--
-- Name: idx_task_runs_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_runs_queue ON public.task_runs USING btree (status, available_at, next_attempt_at, created_at);


--
-- Name: idx_task_runs_requested_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_runs_requested_by ON public.task_runs USING btree (tenant_id, requested_by, created_at DESC);


--
-- Name: idx_task_runs_tenant_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_runs_tenant_category ON public.task_runs USING btree (tenant_id, category, created_at DESC);


--
-- Name: idx_task_runs_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_runs_tenant_status ON public.task_runs USING btree (tenant_id, status, created_at DESC);


--
-- Name: idx_task_runs_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_runs_type ON public.task_runs USING btree (tenant_id, task_type, created_at DESC);


--
-- Name: idx_tenant_memberships_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_memberships_expiry ON public.tenant_memberships USING btree (status, effective_until) WHERE (((status)::text = 'ACTIVE'::text) AND (effective_until IS NOT NULL));


--
-- Name: idx_tenant_memberships_subject_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_memberships_subject_status ON public.tenant_memberships USING btree (subject_type, subject_id, status, effective_from);


--
-- Name: idx_tenant_memberships_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_memberships_tenant_status ON public.tenant_memberships USING btree (tenant_id, status, effective_from);


--
-- Name: idx_tenants_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_parent ON public.tenants USING btree (parent_id);


--
-- Name: idx_tenants_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_status ON public.tenants USING btree (status);


--
-- Name: idx_unified_plugin_bindings_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unified_plugin_bindings_tenant_status ON public.unified_plugin_bindings USING btree (tenant_id, status, plugin_version_id);


--
-- Name: idx_unified_plugin_resources_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unified_plugin_resources_version ON public.unified_plugin_resources USING btree (plugin_version_id, resource_path);


--
-- Name: idx_unified_plugin_versions_catalog; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unified_plugin_versions_catalog ON public.unified_plugin_versions USING btree (tenant_id, status, runtime, source, plugin_id);


--
-- Name: idx_unified_plugin_versions_owner_catalog; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unified_plugin_versions_owner_catalog ON public.unified_plugin_versions USING btree (owner_type, source, status, plugin_id);


--
-- Name: idx_unified_plugin_workflow_binding_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unified_plugin_workflow_binding_owner ON public.unified_plugin_workflow_bindings USING btree (owner_type, owner_id, workflow_version_id);


--
-- Name: idx_unified_plugin_workflow_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unified_plugin_workflow_resource ON public.unified_plugin_workflow_bindings USING btree (plugin_version_id, workflow_resource_path);


--
-- Name: idx_unified_plugin_workflow_resource_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unified_plugin_workflow_resource_key ON public.unified_plugin_workflow_bindings USING btree (plugin_version_id, workflow_resource_path, workflow_key);


--
-- Name: idx_unified_plugin_workflow_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unified_plugin_workflow_version ON public.unified_plugin_workflow_bindings USING btree (workflow_version_id);


--
-- Name: idx_workflow_execution_bindings_fixed_workflow_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_execution_bindings_fixed_workflow_version ON public.workflow_execution_bindings USING btree (tenant_id, workflow_template_id, workflow_version_id);


--
-- Name: idx_workflow_execution_bindings_plugin_capability; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_execution_bindings_plugin_capability ON public.workflow_execution_bindings USING btree (tenant_id, plugin_version_id, capability_key);


--
-- Name: idx_workflow_execution_bindings_plugin_capability_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_execution_bindings_plugin_capability_workflow ON public.workflow_execution_bindings USING btree (tenant_id, plugin_version_id, capability_key, workflow_key);


--
-- Name: idx_workflow_execution_bindings_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_execution_bindings_template ON public.workflow_execution_bindings USING btree (tenant_id, workflow_template_id);


--
-- Name: idx_workflow_execution_bindings_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_execution_bindings_tenant_status ON public.workflow_execution_bindings USING btree (tenant_id, status);


--
-- Name: idx_workflow_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_runs_status ON public.workflow_runs USING btree (tenant_id, status, created_at DESC);


--
-- Name: idx_workflow_templates_type_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_templates_type_status ON public.workflow_templates USING btree (tenant_id, template_type, status);


--
-- Name: uq_application_onboarding_sessions_tenant_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_application_onboarding_sessions_tenant_idempotency ON public.application_onboarding_sessions USING btree (tenant_id, idempotency_key);


--
-- Name: uq_business_permission_active_grant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_business_permission_active_grant ON public.pg_business_permission_grants USING btree (tenant_id, principal_type, principal_id, role_id, domain, level, root_object_type, root_object_id, effect) WHERE ((status)::text = 'active'::text);


--
-- Name: uq_ca_issuance_request; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_ca_issuance_request ON public.pg_ca_issuance_records USING btree (tenant_id, certificate_request_id) WHERE (certificate_request_id IS NOT NULL);


--
-- Name: uq_ca_sync_runs_active_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_ca_sync_runs_active_scope ON public.pg_ca_sync_runs USING btree (tenant_id, provider_id, ca_id, object_type) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));


--
-- Name: uq_certificate_assets_active_domain_env; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_certificate_assets_active_domain_env ON public.certificate_assets USING btree (tenant_id, primary_domain, COALESCE(environment, ''::character varying)) WHERE (deleted_at IS NULL);


--
-- Name: uq_certificate_bindings_file_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_certificate_bindings_file_active ON public.certificate_bindings USING btree (tenant_id, service_instance_id, COALESCE(domain_name, ''::character varying), cert_path) WHERE ((deleted_at IS NULL) AND ((binding_type)::text = 'FILE_PATH'::text));


--
-- Name: uq_certificate_bindings_keystore_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_certificate_bindings_keystore_active ON public.certificate_bindings USING btree (tenant_id, service_instance_id, COALESCE(domain_name, ''::character varying), keystore_path) WHERE ((deleted_at IS NULL) AND ((binding_type)::text = 'KEYSTORE'::text));


--
-- Name: uq_certificate_bindings_store_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_certificate_bindings_store_active ON public.certificate_bindings USING btree (tenant_id, service_instance_id, COALESCE(domain_name, ''::character varying), store_location, store_name, COALESCE(store_thumbprint, ''::character varying)) WHERE ((deleted_at IS NULL) AND ((binding_type)::text = 'WINDOWS_CERT_STORE'::text));


--
-- Name: uq_cloud_account_assets_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_cloud_account_assets_identity ON public.pg_cloud_account_assets USING btree (tenant_id, identity_key) WHERE (deleted_at IS NULL);


--
-- Name: uq_credential_profiles_tenant_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_credential_profiles_tenant_name ON public.credential_profiles USING btree (tenant_id, lower(name));


--
-- Name: uq_database_forward_cleanup_audits_audit_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_database_forward_cleanup_audits_audit_id ON public.database_forward_cleanup_audits USING btree (audit_id);


--
-- Name: uq_device_liveness_observation; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_device_liveness_observation ON public.pg_device_liveness_signals USING btree (tenant_id, observation_id) WHERE (observation_id IS NOT NULL);


--
-- Name: uq_hosts_active_hostname; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hosts_active_hostname ON public.hosts USING btree (tenant_id, hostname) WHERE (deleted_at IS NULL);


--
-- Name: uq_notification_channels_tenant_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_notification_channels_tenant_name ON public.notification_channels USING btree (tenant_id, lower(name)) WHERE (deleted_at IS NULL);


--
-- Name: uq_notification_routes_tenant_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_notification_routes_tenant_name ON public.notification_routes USING btree (tenant_id, lower(name)) WHERE (deleted_at IS NULL);


--
-- Name: uq_pg_acme_accounts_directory_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_acme_accounts_directory_key ON public.pg_acme_accounts USING btree (tenant_id, provider_id, directory_url_hash, account_key_secret_ref);


--
-- Name: uq_pg_acme_authorizations_url; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_acme_authorizations_url ON public.pg_acme_authorizations USING btree (tenant_id, external_authorization_url);


--
-- Name: uq_pg_acme_challenges_url; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_acme_challenges_url ON public.pg_acme_challenges USING btree (tenant_id, external_challenge_url);


--
-- Name: uq_pg_acme_http01_presentation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_acme_http01_presentation_id ON public.pg_acme_http01_presentations USING btree (tenant_id, presentation_id);


--
-- Name: uq_pg_acme_orders_active_request; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_acme_orders_active_request ON public.pg_acme_orders USING btree (tenant_id, certificate_request_id) WHERE (status = ANY (ARRAY['pending'::text, 'ready'::text, 'processing'::text]));


--
-- Name: uq_pg_acme_orders_external_url; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_acme_orders_external_url ON public.pg_acme_orders USING btree (tenant_id, external_order_url);


--
-- Name: uq_pg_acme_plugin_accounts_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_acme_plugin_accounts_identity ON public.pg_acme_plugin_accounts USING btree (tenant_id, directory_url, email, account_key_secret_ref);


--
-- Name: uq_pg_acme_plugin_challenges_url; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_acme_plugin_challenges_url ON public.pg_acme_plugin_challenges USING btree (tenant_id, challenge_url);


--
-- Name: uq_pg_acme_plugin_operations_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_acme_plugin_operations_key ON public.pg_acme_plugin_operations USING btree (tenant_id, idempotency_key);


--
-- Name: uq_pg_acme_renewal_policies_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_acme_renewal_policies_asset ON public.pg_acme_renewal_policies USING btree (tenant_id, certificate_asset_id) WHERE ((certificate_asset_id IS NOT NULL) AND (status <> 'disabled'::text));


--
-- Name: uq_pg_acme_renewal_policies_binding; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_acme_renewal_policies_binding ON public.pg_acme_renewal_policies USING btree (tenant_id, binding_id) WHERE ((binding_id IS NOT NULL) AND (status <> 'disabled'::text));


--
-- Name: uq_pg_application_asset_targets_active_application; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_application_asset_targets_active_application ON public.pg_application_asset_targets USING btree (tenant_id, application_asset_id) WHERE (deleted_at IS NULL);


--
-- Name: uq_pg_application_asset_targets_target; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_application_asset_targets_target ON public.pg_application_asset_targets USING btree (tenant_id, application_asset_id, managed_target_id) WHERE (deleted_at IS NULL);


--
-- Name: uq_pg_asset_conflicts_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_asset_conflicts_open ON public.pg_asset_conflicts USING btree (tenant_id, resource_type, resource_id, field, source_snapshot_id) WHERE ((status)::text = 'open'::text);


--
-- Name: uq_pg_ca_node_enrollment_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_ca_node_enrollment_token_hash ON public.pg_ca_node_enrollment_tokens USING btree (token_hash);


--
-- Name: uq_pg_ca_node_tasks_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_ca_node_tasks_idempotency ON public.pg_ca_node_tasks USING btree (tenant_id, idempotency_key);


--
-- Name: uq_pg_ca_nodes_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_ca_nodes_identity ON public.pg_ca_nodes USING btree (tenant_id, identity_fingerprint);


--
-- Name: uq_pg_ca_providers_tenant_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_ca_providers_tenant_name ON public.pg_ca_providers USING btree (tenant_id, lower(name));


--
-- Name: uq_pg_ca_trust_domains_tenant_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_ca_trust_domains_tenant_code ON public.pg_ca_trust_domains USING btree (tenant_id, code);


--
-- Name: uq_pg_ca_trust_domains_tenant_default; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_ca_trust_domains_tenant_default ON public.pg_ca_trust_domains USING btree (tenant_id) WHERE ((is_default = true) AND (status <> ALL (ARRAY['retired'::text, 'compromised'::text])));


--
-- Name: uq_pg_ca_trust_domains_tenant_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_ca_trust_domains_tenant_name ON public.pg_ca_trust_domains USING btree (tenant_id, lower(name));


--
-- Name: uq_pg_certificate_assets_tenant_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_certificate_assets_tenant_domain ON public.pg_certificate_assets USING btree (tenant_id, lower((primary_domain)::text)) WHERE ((status)::text <> 'deleted'::text);


--
-- Name: uq_pg_certificate_assets_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_certificate_assets_tenant_id ON public.pg_certificate_assets USING btree (tenant_id, id);


--
-- Name: uq_pg_certificate_authorities_tenant_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_certificate_authorities_tenant_name ON public.pg_certificate_authorities USING btree (tenant_id, lower(name));


--
-- Name: uq_pg_certificate_bindings_file_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_certificate_bindings_file_active ON public.pg_certificate_bindings USING btree (tenant_id, service_instance_id, COALESCE(domain_name, ''::character varying), cert_path) WHERE ((deleted_at IS NULL) AND ((binding_type)::text = 'FILE_PATH'::text));


--
-- Name: uq_pg_certificate_bindings_keystore_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_certificate_bindings_keystore_active ON public.pg_certificate_bindings USING btree (tenant_id, service_instance_id, COALESCE(domain_name, ''::character varying), keystore_path) WHERE ((deleted_at IS NULL) AND ((binding_type)::text = 'KEYSTORE'::text));


--
-- Name: uq_pg_certificate_bindings_store_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_certificate_bindings_store_active ON public.pg_certificate_bindings USING btree (tenant_id, service_instance_id, COALESCE(domain_name, ''::character varying), store_location, store_name, COALESCE(store_thumbprint, ''::character varying)) WHERE ((deleted_at IS NULL) AND ((binding_type)::text = 'WINDOWS_CERT_STORE'::text));


--
-- Name: uq_pg_certificate_issuances_request; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_certificate_issuances_request ON public.pg_certificate_issuances USING btree (certificate_request_id);


--
-- Name: uq_pg_certificate_profile_versions; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_certificate_profile_versions ON public.pg_certificate_profile_versions USING btree (profile_id, version_no);


--
-- Name: uq_pg_certificate_profiles_tenant_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_certificate_profiles_tenant_name ON public.pg_certificate_profiles USING btree (tenant_id, lower(name));


--
-- Name: uq_pg_certificate_renewal_jobs_acme_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_certificate_renewal_jobs_acme_active ON public.pg_certificate_renewal_jobs USING btree (tenant_id, source_certificate_version_id, renewal_window_key) WHERE ((source_certificate_version_id IS NOT NULL) AND (status <> ALL (ARRAY['completed'::text, 'failed'::text, 'rollback_required'::text, 'cancelled'::text])));


--
-- Name: uq_pg_certificate_renewal_jobs_acme_initial; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_certificate_renewal_jobs_acme_initial ON public.pg_certificate_renewal_jobs USING btree (tenant_id, renewal_window_key) WHERE ((source_certificate_version_id IS NULL) AND (policy_id IS NOT NULL) AND (status <> ALL (ARRAY['completed'::text, 'failed'::text, 'rollback_required'::text, 'cancelled'::text, 'issued_waiting_for_installation'::text])));


--
-- Name: uq_pg_certificate_renewal_jobs_window; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_certificate_renewal_jobs_window ON public.pg_certificate_renewal_jobs USING btree (tenant_id, certificate_version_id, renewal_window_key);


--
-- Name: uq_pg_certificate_requests_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_certificate_requests_idempotency ON public.pg_certificate_requests USING btree (tenant_id, idempotency_key);


--
-- Name: uq_pg_certificate_version_formats_tenant_natural; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_certificate_version_formats_tenant_natural ON public.pg_certificate_version_formats USING btree (tenant_id, certificate_version_id, format, parameter_hash);


--
-- Name: uq_pg_certificate_version_trust_roots_relation; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_certificate_version_trust_roots_relation ON public.pg_certificate_version_trust_roots USING btree (tenant_id, certificate_version_id, relation);


--
-- Name: uq_pg_certificate_versions_tenant_asset_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_certificate_versions_tenant_asset_version ON public.pg_certificate_versions USING btree (tenant_id, certificate_asset_id, version_no);


--
-- Name: uq_pg_certificate_versions_tenant_fingerprint; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_certificate_versions_tenant_fingerprint ON public.pg_certificate_versions USING btree (tenant_id, fingerprint_sha256);


--
-- Name: uq_pg_certificate_versions_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_certificate_versions_tenant_id ON public.pg_certificate_versions USING btree (tenant_id, id);


--
-- Name: uq_pg_device_assets_active_host_family; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_device_assets_active_host_family ON public.pg_device_assets USING btree (tenant_id, host_id, device_family) WHERE (host_id IS NOT NULL);


--
-- Name: uq_pg_device_assets_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_device_assets_identity ON public.pg_device_assets USING btree (tenant_id, device_family, service_asset_id);


--
-- Name: uq_pg_device_certificate_bindings_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_device_certificate_bindings_identity ON public.pg_device_certificate_bindings USING btree (tenant_id, device_asset_id, binding_key) WHERE (deleted_at IS NULL);


--
-- Name: uq_pg_device_certificate_resources_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_device_certificate_resources_identity ON public.pg_device_certificate_resources USING btree (tenant_id, device_asset_id, certkey_name) WHERE (deleted_at IS NULL);


--
-- Name: uq_pg_device_virtual_servers_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_device_virtual_servers_identity ON public.pg_device_virtual_servers USING btree (tenant_id, device_asset_id, virtual_server_type, virtual_server_name) WHERE (deleted_at IS NULL);


--
-- Name: uq_pg_discovery_snapshots_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_discovery_snapshots_hash ON public.pg_discovery_snapshots USING btree (tenant_id, normalized_hash);


--
-- Name: uq_pg_framework_instances_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_framework_instances_identity ON public.pg_framework_instances USING btree (tenant_id, COALESCE(asset_id, ''::text), COALESCE(device_id, ''::text), discovery_provider_key, framework_key) WHERE (deleted_at IS NULL);


--
-- Name: uq_pg_hosts_active_agent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_hosts_active_agent_id ON public.pg_hosts USING btree (tenant_id, agent_id) WHERE ((deleted_at IS NULL) AND (agent_id IS NOT NULL));


--
-- Name: uq_pg_hosts_active_asset_fingerprint; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_hosts_active_asset_fingerprint ON public.pg_hosts USING btree (tenant_id, asset_fingerprint) WHERE ((deleted_at IS NULL) AND (asset_fingerprint IS NOT NULL));


--
-- Name: uq_pg_hosts_active_hostname; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_hosts_active_hostname ON public.pg_hosts USING btree (tenant_id, hostname) WHERE ((deleted_at IS NULL) AND (hostname IS NOT NULL));


--
-- Name: uq_pg_hosts_active_primary_ip; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_hosts_active_primary_ip ON public.pg_hosts USING btree (tenant_id, primary_ip) WHERE ((deleted_at IS NULL) AND (primary_ip IS NOT NULL));


--
-- Name: uq_pg_managed_targets_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_managed_targets_identity ON public.pg_managed_targets USING btree (tenant_id, COALESCE(asset_id, ''::text), COALESCE(device_id, ''::text), discovery_provider_key, target_type, target_key) WHERE (deleted_at IS NULL);


--
-- Name: uq_pg_monitor_certificate_observations_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_monitor_certificate_observations_version ON public.pg_monitor_certificate_observations USING btree (COALESCE(tenant_id, ''::text), service_asset_id, upper(regexp_replace(fingerprint_sha256, '[^a-fA-F0-9]'::text, ''::text, 'g'::text)));


--
-- Name: uq_pg_monitor_risk_events_tenant_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_monitor_risk_events_tenant_dedup ON public.pg_monitor_risk_events USING btree (COALESCE(tenant_id, ''::text), dedup_key);


--
-- Name: uq_pg_monitor_targets_active_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_monitor_targets_active_asset ON public.pg_monitor_targets USING btree (tenant_id, service_asset_id) WHERE (deleted_at IS NULL);


--
-- Name: uq_pg_root_certificate_records_fingerprint; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_root_certificate_records_fingerprint ON public.pg_root_certificate_records USING btree (fingerprint_sha256);


--
-- Name: uq_pg_service_assets_active_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_service_assets_active_identity ON public.pg_service_assets USING btree (tenant_id, address, port, protocol) WHERE (deleted_at IS NULL);


--
-- Name: uq_pg_site_assets_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pg_site_assets_identity ON public.pg_site_assets USING btree (tenant_id, COALESCE(asset_id, ''::text), COALESCE(device_id, ''::text), discovery_provider_key, site_key) WHERE (deleted_at IS NULL);


--
-- Name: uq_plugin_promotion_records_active_source; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_plugin_promotion_records_active_source ON public.plugin_promotion_records USING btree (tenant_id, source_plugin_binding_id) WHERE ((status)::text = ANY ((ARRAY['PREVIEWED'::character varying, 'RUNNING'::character varying, 'COMPLETED'::character varying])::text[]));


--
-- Name: uq_plugin_runner_version_bindings_tenant_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_plugin_runner_version_bindings_tenant_identity ON public.plugin_runner_version_bindings USING btree (tenant_id, canonical_plugin_id, plugin_version);


--
-- Name: uq_task_runs_active_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_task_runs_active_idempotency ON public.task_runs USING btree (tenant_id, task_type, idempotency_key) WHERE ((idempotency_key IS NOT NULL) AND (status <> ALL (ARRAY['SUCCEEDED'::text, 'FAILED'::text, 'CANCELLED'::text])));


--
-- Name: uq_tenant_memberships_active_subject_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_tenant_memberships_active_subject_tenant ON public.tenant_memberships USING btree (subject_type, subject_id, tenant_id) WHERE ((status)::text = 'ACTIVE'::text);


--
-- Name: uq_unified_plugin_versions_current; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_unified_plugin_versions_current ON public.unified_plugin_versions USING btree (tenant_id, plugin_id) WHERE ((status)::text = 'ENABLED'::text);


--
-- Name: ux_browser_credential_sessions_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_browser_credential_sessions_idempotency ON public.browser_credential_sessions USING btree (tenant_id, created_by, idempotency_key_hash) WHERE (idempotency_key_hash IS NOT NULL);


--
-- Name: deployment_input_snapshots trg_deployment_input_snapshots_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_deployment_input_snapshots_immutable BEFORE DELETE OR UPDATE ON public.deployment_input_snapshots FOR EACH ROW EXECUTE FUNCTION public.gcac_reject_deployment_input_snapshot_mutation();


--
-- Name: plugin_runner_version_bindings trg_plugin_runner_binding_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_plugin_runner_binding_guard BEFORE INSERT OR UPDATE ON public.plugin_runner_version_bindings FOR EACH ROW EXECUTE FUNCTION public.gcac_plugin_runner_binding_guard();


--
-- Name: unified_plugin_versions trg_plugin_runner_version_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_plugin_runner_version_guard BEFORE UPDATE ON public.unified_plugin_versions FOR EACH ROW EXECUTE FUNCTION public.gcac_plugin_runner_version_guard();


--
-- Name: tenants trg_validate_tenant_hierarchy; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_validate_tenant_hierarchy AFTER INSERT OR UPDATE OF tenant_type, parent_id, status ON public.tenants DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION public.validate_tenant_hierarchy();


--
-- Name: agents agents_host_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_host_id_fkey FOREIGN KEY (host_id) REFERENCES public.hosts(id);


--
-- Name: agents agents_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: audit_events audit_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: automation_run_action_results automation_run_action_results_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_run_action_results
    ADD CONSTRAINT automation_run_action_results_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.automation_runs(id);


--
-- Name: automation_run_action_results automation_run_action_results_run_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_run_action_results
    ADD CONSTRAINT automation_run_action_results_run_target_id_fkey FOREIGN KEY (run_target_id) REFERENCES public.automation_run_targets(id);


--
-- Name: automation_run_targets automation_run_targets_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_run_targets
    ADD CONSTRAINT automation_run_targets_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.automation_runs(id);


--
-- Name: automation_runs automation_runs_automation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_automation_id_fkey FOREIGN KEY (automation_id) REFERENCES public.automation_definitions(id);


--
-- Name: automation_runs automation_runs_parent_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_parent_run_id_fkey FOREIGN KEY (parent_run_id) REFERENCES public.automation_runs(id);


--
-- Name: automation_trigger_deliveries automation_trigger_deliveries_automation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_trigger_deliveries
    ADD CONSTRAINT automation_trigger_deliveries_automation_id_fkey FOREIGN KEY (automation_id) REFERENCES public.automation_definitions(id);


--
-- Name: automation_trigger_deliveries automation_trigger_deliveries_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_trigger_deliveries
    ADD CONSTRAINT automation_trigger_deliveries_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.automation_runs(id);


--
-- Name: automation_versions automation_versions_automation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_versions
    ADD CONSTRAINT automation_versions_automation_id_fkey FOREIGN KEY (automation_id) REFERENCES public.automation_definitions(id);


--
-- Name: backup_artifacts backup_artifacts_certificate_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_artifacts
    ADD CONSTRAINT backup_artifacts_certificate_binding_id_fkey FOREIGN KEY (certificate_binding_id) REFERENCES public.certificate_bindings(id);


--
-- Name: backup_artifacts backup_artifacts_execution_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_artifacts
    ADD CONSTRAINT backup_artifacts_execution_run_id_fkey FOREIGN KEY (execution_run_id) REFERENCES public.execution_runs(id);


--
-- Name: backup_artifacts backup_artifacts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_artifacts
    ADD CONSTRAINT backup_artifacts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: certificate_assets certificate_assets_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_assets
    ADD CONSTRAINT certificate_assets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: certificate_bindings certificate_bindings_certificate_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_bindings
    ADD CONSTRAINT certificate_bindings_certificate_version_id_fkey FOREIGN KEY (certificate_version_id) REFERENCES public.certificate_versions(id);


--
-- Name: certificate_bindings certificate_bindings_service_endpoint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_bindings
    ADD CONSTRAINT certificate_bindings_service_endpoint_id_fkey FOREIGN KEY (service_endpoint_id) REFERENCES public.service_endpoints(id);


--
-- Name: certificate_bindings certificate_bindings_service_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_bindings
    ADD CONSTRAINT certificate_bindings_service_instance_id_fkey FOREIGN KEY (service_instance_id) REFERENCES public.service_instances(id);


--
-- Name: certificate_bindings certificate_bindings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_bindings
    ADD CONSTRAINT certificate_bindings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: certificate_observations certificate_observations_monitor_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_observations
    ADD CONSTRAINT certificate_observations_monitor_target_id_fkey FOREIGN KEY (monitor_target_id) REFERENCES public.monitor_targets(id);


--
-- Name: certificate_observations certificate_observations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_observations
    ADD CONSTRAINT certificate_observations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: certificate_version_formats certificate_version_formats_certificate_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_version_formats
    ADD CONSTRAINT certificate_version_formats_certificate_version_id_fkey FOREIGN KEY (certificate_version_id) REFERENCES public.certificate_versions(id);


--
-- Name: certificate_version_formats certificate_version_formats_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_version_formats
    ADD CONSTRAINT certificate_version_formats_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: certificate_versions certificate_versions_certificate_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_versions
    ADD CONSTRAINT certificate_versions_certificate_asset_id_fkey FOREIGN KEY (certificate_asset_id) REFERENCES public.certificate_assets(id);


--
-- Name: certificate_versions certificate_versions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_versions
    ADD CONSTRAINT certificate_versions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: deployment_input_artifact_binding_migration_backups deployment_input_artifact_binding_migrat_plugin_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployment_input_artifact_binding_migration_backups
    ADD CONSTRAINT deployment_input_artifact_binding_migrat_plugin_binding_id_fkey FOREIGN KEY (plugin_binding_id) REFERENCES public.unified_plugin_bindings(id);


--
-- Name: deployment_input_binding_sanitization_backups deployment_input_binding_sanitization_ba_plugin_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployment_input_binding_sanitization_backups
    ADD CONSTRAINT deployment_input_binding_sanitization_ba_plugin_binding_id_fkey FOREIGN KEY (plugin_binding_id) REFERENCES public.unified_plugin_bindings(id);


--
-- Name: deployment_plan_targets deployment_plan_targets_certificate_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployment_plan_targets
    ADD CONSTRAINT deployment_plan_targets_certificate_binding_id_fkey FOREIGN KEY (certificate_binding_id) REFERENCES public.certificate_bindings(id);


--
-- Name: deployment_plan_targets deployment_plan_targets_deployment_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployment_plan_targets
    ADD CONSTRAINT deployment_plan_targets_deployment_plan_id_fkey FOREIGN KEY (deployment_plan_id) REFERENCES public.deployment_plans(id);


--
-- Name: deployment_plan_targets deployment_plan_targets_execution_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployment_plan_targets
    ADD CONSTRAINT deployment_plan_targets_execution_target_id_fkey FOREIGN KEY (execution_target_id) REFERENCES public.execution_targets(id);


--
-- Name: deployment_plan_targets deployment_plan_targets_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployment_plan_targets
    ADD CONSTRAINT deployment_plan_targets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: deployment_plans deployment_plans_certificate_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployment_plans
    ADD CONSTRAINT deployment_plans_certificate_version_id_fkey FOREIGN KEY (certificate_version_id) REFERENCES public.certificate_versions(id);


--
-- Name: deployment_plans deployment_plans_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployment_plans
    ADD CONSTRAINT deployment_plans_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: execution_runs execution_runs_deployment_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_runs
    ADD CONSTRAINT execution_runs_deployment_plan_id_fkey FOREIGN KEY (deployment_plan_id) REFERENCES public.deployment_plans(id);


--
-- Name: execution_runs execution_runs_execution_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_runs
    ADD CONSTRAINT execution_runs_execution_target_id_fkey FOREIGN KEY (execution_target_id) REFERENCES public.execution_targets(id);


--
-- Name: execution_runs execution_runs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_runs
    ADD CONSTRAINT execution_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: execution_steps execution_steps_execution_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_steps
    ADD CONSTRAINT execution_steps_execution_run_id_fkey FOREIGN KEY (execution_run_id) REFERENCES public.execution_runs(id);


--
-- Name: execution_steps execution_steps_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_steps
    ADD CONSTRAINT execution_steps_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: execution_targets execution_targets_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_targets
    ADD CONSTRAINT execution_targets_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id);


--
-- Name: execution_targets execution_targets_gateway_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_targets
    ADD CONSTRAINT execution_targets_gateway_id_fkey FOREIGN KEY (gateway_id) REFERENCES public.gateways(id);


--
-- Name: execution_targets execution_targets_host_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_targets
    ADD CONSTRAINT execution_targets_host_id_fkey FOREIGN KEY (host_id) REFERENCES public.hosts(id);


--
-- Name: execution_targets execution_targets_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_targets
    ADD CONSTRAINT execution_targets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: plugin_runner_version_bindings fk_plugin_runner_version_bindings_tenant_version; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_runner_version_bindings
    ADD CONSTRAINT fk_plugin_runner_version_bindings_tenant_version FOREIGN KEY (tenant_id, plugin_version_id) REFERENCES public.unified_plugin_versions(tenant_id, id) ON DELETE RESTRICT;


--
-- Name: tenants fk_tenants_parent; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT fk_tenants_parent FOREIGN KEY (parent_id) REFERENCES public.tenants(id);


--
-- Name: workflow_execution_bindings fk_workflow_execution_bindings_plugin_version; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_execution_bindings
    ADD CONSTRAINT fk_workflow_execution_bindings_plugin_version FOREIGN KEY (plugin_version_id) REFERENCES public.unified_plugin_versions(id) ON DELETE RESTRICT;


--
-- Name: workflow_execution_bindings fk_workflow_execution_bindings_plugin_workflow; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_execution_bindings
    ADD CONSTRAINT fk_workflow_execution_bindings_plugin_workflow FOREIGN KEY (plugin_version_id, capability_key, workflow_key) REFERENCES public.unified_plugin_workflow_bindings(plugin_version_id, capability_key, workflow_key) ON DELETE RESTRICT;


--
-- Name: gateways gateways_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateways
    ADD CONSTRAINT gateways_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id);


--
-- Name: gateways gateways_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateways
    ADD CONSTRAINT gateways_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: hosts hosts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hosts
    ADD CONSTRAINT hosts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: monitor_targets monitor_targets_certificate_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monitor_targets
    ADD CONSTRAINT monitor_targets_certificate_binding_id_fkey FOREIGN KEY (certificate_binding_id) REFERENCES public.certificate_bindings(id);


--
-- Name: monitor_targets monitor_targets_service_endpoint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monitor_targets
    ADD CONSTRAINT monitor_targets_service_endpoint_id_fkey FOREIGN KEY (service_endpoint_id) REFERENCES public.service_endpoints(id);


--
-- Name: monitor_targets monitor_targets_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monitor_targets
    ADD CONSTRAINT monitor_targets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: notification_deliveries notification_deliveries_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.notification_channels(id);


--
-- Name: notification_deliveries notification_deliveries_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.notification_requests(id) ON DELETE CASCADE;


--
-- Name: notification_delivery_attempts notification_delivery_attempts_delivery_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_delivery_attempts
    ADD CONSTRAINT notification_delivery_attempts_delivery_id_fkey FOREIGN KEY (delivery_id) REFERENCES public.notification_deliveries(id) ON DELETE CASCADE;


--
-- Name: notification_requests notification_requests_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_requests
    ADD CONSTRAINT notification_requests_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.notification_channels(id);


--
-- Name: notification_requests notification_requests_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_requests
    ADD CONSTRAINT notification_requests_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.notification_routes(id);


--
-- Name: object_permission_access_grants object_permission_access_grants_object_set_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_permission_access_grants
    ADD CONSTRAINT object_permission_access_grants_object_set_id_fkey FOREIGN KEY (object_set_id) REFERENCES public.object_permission_object_sets(id);


--
-- Name: object_permission_group_members object_permission_group_members_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_permission_group_members
    ADD CONSTRAINT object_permission_group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.object_permission_groups(id);


--
-- Name: object_permission_object_set_members object_permission_object_set_members_object_set_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_permission_object_set_members
    ADD CONSTRAINT object_permission_object_set_members_object_set_id_fkey FOREIGN KEY (object_set_id) REFERENCES public.object_permission_object_sets(id);


--
-- Name: object_permission_role_bindings object_permission_role_bindings_object_set_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_permission_role_bindings
    ADD CONSTRAINT object_permission_role_bindings_object_set_id_fkey FOREIGN KEY (object_set_id) REFERENCES public.object_permission_object_sets(id);


--
-- Name: pg_acme_accounts pg_acme_accounts_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_accounts
    ADD CONSTRAINT pg_acme_accounts_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.pg_ca_providers(id);


--
-- Name: pg_acme_authorizations pg_acme_authorizations_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_authorizations
    ADD CONSTRAINT pg_acme_authorizations_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.pg_acme_orders(id);


--
-- Name: pg_acme_challenges pg_acme_challenges_authorization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_challenges
    ADD CONSTRAINT pg_acme_challenges_authorization_id_fkey FOREIGN KEY (authorization_id) REFERENCES public.pg_acme_authorizations(id);


--
-- Name: pg_acme_challenges pg_acme_challenges_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_challenges
    ADD CONSTRAINT pg_acme_challenges_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.pg_acme_orders(id);


--
-- Name: pg_acme_orders pg_acme_orders_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_orders
    ADD CONSTRAINT pg_acme_orders_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.pg_acme_accounts(id);


--
-- Name: pg_acme_orders pg_acme_orders_certificate_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_orders
    ADD CONSTRAINT pg_acme_orders_certificate_request_id_fkey FOREIGN KEY (certificate_request_id) REFERENCES public.pg_certificate_requests(id);


--
-- Name: pg_acme_orders pg_acme_orders_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_orders
    ADD CONSTRAINT pg_acme_orders_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.pg_ca_providers(id);


--
-- Name: pg_acme_renewal_policies pg_acme_renewal_policies_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_renewal_policies
    ADD CONSTRAINT pg_acme_renewal_policies_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.pg_acme_accounts(id);


--
-- Name: pg_acme_renewal_policies pg_acme_renewal_policies_certificate_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_renewal_policies
    ADD CONSTRAINT pg_acme_renewal_policies_certificate_asset_id_fkey FOREIGN KEY (certificate_asset_id) REFERENCES public.pg_certificate_assets(id);


--
-- Name: pg_acme_renewal_policies pg_acme_renewal_policies_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_acme_renewal_policies
    ADD CONSTRAINT pg_acme_renewal_policies_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.pg_ca_providers(id);


--
-- Name: pg_application_asset_targets pg_application_asset_targets_application_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_application_asset_targets
    ADD CONSTRAINT pg_application_asset_targets_application_asset_id_fkey FOREIGN KEY (application_asset_id) REFERENCES public.pg_service_assets(id);


--
-- Name: pg_application_asset_targets pg_application_asset_targets_managed_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_application_asset_targets
    ADD CONSTRAINT pg_application_asset_targets_managed_target_id_fkey FOREIGN KEY (managed_target_id) REFERENCES public.pg_managed_targets(id);


--
-- Name: pg_ca_node_enrollment_tokens pg_ca_node_enrollment_tokens_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_node_enrollment_tokens
    ADD CONSTRAINT pg_ca_node_enrollment_tokens_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.pg_ca_providers(id);


--
-- Name: pg_ca_node_request_nonces pg_ca_node_request_nonces_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_node_request_nonces
    ADD CONSTRAINT pg_ca_node_request_nonces_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.pg_ca_nodes(id) ON DELETE CASCADE;


--
-- Name: pg_ca_node_tasks pg_ca_node_tasks_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_node_tasks
    ADD CONSTRAINT pg_ca_node_tasks_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.pg_ca_nodes(id);


--
-- Name: pg_ca_node_tasks pg_ca_node_tasks_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_node_tasks
    ADD CONSTRAINT pg_ca_node_tasks_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.pg_ca_providers(id);


--
-- Name: pg_ca_nodes pg_ca_nodes_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_ca_nodes
    ADD CONSTRAINT pg_ca_nodes_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.pg_ca_providers(id);


--
-- Name: pg_certificate_authorities pg_certificate_authorities_certificate_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_authorities
    ADD CONSTRAINT pg_certificate_authorities_certificate_version_id_fkey FOREIGN KEY (certificate_version_id) REFERENCES public.pg_certificate_versions(id);


--
-- Name: pg_certificate_authorities pg_certificate_authorities_parent_ca_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_authorities
    ADD CONSTRAINT pg_certificate_authorities_parent_ca_id_fkey FOREIGN KEY (parent_ca_id) REFERENCES public.pg_certificate_authorities(id);


--
-- Name: pg_certificate_authorities pg_certificate_authorities_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_authorities
    ADD CONSTRAINT pg_certificate_authorities_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.pg_ca_providers(id);


--
-- Name: pg_certificate_authorities pg_certificate_authorities_trust_domain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_authorities
    ADD CONSTRAINT pg_certificate_authorities_trust_domain_id_fkey FOREIGN KEY (trust_domain_id) REFERENCES public.pg_ca_trust_domains(id);


--
-- Name: pg_certificate_bindings pg_certificate_bindings_certificate_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_bindings
    ADD CONSTRAINT pg_certificate_bindings_certificate_version_id_fkey FOREIGN KEY (certificate_version_id) REFERENCES public.pg_certificate_versions(id);


--
-- Name: pg_certificate_bindings pg_certificate_bindings_managed_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_bindings
    ADD CONSTRAINT pg_certificate_bindings_managed_target_id_fkey FOREIGN KEY (managed_target_id) REFERENCES public.pg_managed_targets(id);


--
-- Name: pg_certificate_bindings pg_certificate_bindings_service_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_bindings
    ADD CONSTRAINT pg_certificate_bindings_service_asset_id_fkey FOREIGN KEY (service_asset_id) REFERENCES public.pg_service_assets(id);


--
-- Name: pg_certificate_bindings pg_certificate_bindings_service_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_bindings
    ADD CONSTRAINT pg_certificate_bindings_service_instance_id_fkey FOREIGN KEY (service_instance_id) REFERENCES public.pg_framework_instances(id);


--
-- Name: pg_certificate_bindings pg_certificate_bindings_site_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_bindings
    ADD CONSTRAINT pg_certificate_bindings_site_asset_id_fkey FOREIGN KEY (site_asset_id) REFERENCES public.pg_site_assets(id);


--
-- Name: pg_certificate_issuances pg_certificate_issuances_certificate_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_issuances
    ADD CONSTRAINT pg_certificate_issuances_certificate_request_id_fkey FOREIGN KEY (certificate_request_id) REFERENCES public.pg_certificate_requests(id);


--
-- Name: pg_certificate_issuances pg_certificate_issuances_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_issuances
    ADD CONSTRAINT pg_certificate_issuances_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.pg_ca_providers(id);


--
-- Name: pg_certificate_profile_versions pg_certificate_profile_versions_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_profile_versions
    ADD CONSTRAINT pg_certificate_profile_versions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.pg_certificate_profiles(id);


--
-- Name: pg_certificate_profiles pg_certificate_profiles_trust_domain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_profiles
    ADD CONSTRAINT pg_certificate_profiles_trust_domain_id_fkey FOREIGN KEY (trust_domain_id) REFERENCES public.pg_ca_trust_domains(id);


--
-- Name: pg_certificate_renewal_jobs pg_certificate_renewal_jobs_acme_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_renewal_jobs
    ADD CONSTRAINT pg_certificate_renewal_jobs_acme_order_id_fkey FOREIGN KEY (acme_order_id) REFERENCES public.pg_acme_orders(id);


--
-- Name: pg_certificate_renewal_jobs pg_certificate_renewal_jobs_certificate_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_renewal_jobs
    ADD CONSTRAINT pg_certificate_renewal_jobs_certificate_request_id_fkey FOREIGN KEY (certificate_request_id) REFERENCES public.pg_certificate_requests(id);


--
-- Name: pg_certificate_renewal_jobs pg_certificate_renewal_jobs_certificate_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_renewal_jobs
    ADD CONSTRAINT pg_certificate_renewal_jobs_certificate_version_id_fkey FOREIGN KEY (certificate_version_id) REFERENCES public.pg_certificate_versions(id);


--
-- Name: pg_certificate_renewal_jobs pg_certificate_renewal_jobs_policy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_renewal_jobs
    ADD CONSTRAINT pg_certificate_renewal_jobs_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES public.pg_acme_renewal_policies(id);


--
-- Name: pg_certificate_renewal_jobs pg_certificate_renewal_jobs_source_certificate_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_renewal_jobs
    ADD CONSTRAINT pg_certificate_renewal_jobs_source_certificate_version_id_fkey FOREIGN KEY (source_certificate_version_id) REFERENCES public.pg_certificate_versions(id);


--
-- Name: pg_certificate_requests pg_certificate_requests_ca_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_requests
    ADD CONSTRAINT pg_certificate_requests_ca_id_fkey FOREIGN KEY (ca_id) REFERENCES public.pg_certificate_authorities(id);


--
-- Name: pg_certificate_requests pg_certificate_requests_certificate_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_requests
    ADD CONSTRAINT pg_certificate_requests_certificate_version_id_fkey FOREIGN KEY (certificate_version_id) REFERENCES public.pg_certificate_versions(id);


--
-- Name: pg_certificate_requests pg_certificate_requests_key_reference_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_requests
    ADD CONSTRAINT pg_certificate_requests_key_reference_id_fkey FOREIGN KEY (key_reference_id) REFERENCES public.pg_key_references(id);


--
-- Name: pg_certificate_requests pg_certificate_requests_profile_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_requests
    ADD CONSTRAINT pg_certificate_requests_profile_version_id_fkey FOREIGN KEY (profile_version_id) REFERENCES public.pg_certificate_profile_versions(id);


--
-- Name: pg_certificate_requests pg_certificate_requests_trust_domain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_requests
    ADD CONSTRAINT pg_certificate_requests_trust_domain_id_fkey FOREIGN KEY (trust_domain_id) REFERENCES public.pg_ca_trust_domains(id);


--
-- Name: pg_certificate_revocations pg_certificate_revocations_ca_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_revocations
    ADD CONSTRAINT pg_certificate_revocations_ca_id_fkey FOREIGN KEY (ca_id) REFERENCES public.pg_certificate_authorities(id);


--
-- Name: pg_certificate_revocations pg_certificate_revocations_certificate_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_revocations
    ADD CONSTRAINT pg_certificate_revocations_certificate_version_id_fkey FOREIGN KEY (certificate_version_id) REFERENCES public.pg_certificate_versions(id);


--
-- Name: pg_certificate_revocations pg_certificate_revocations_trust_domain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_revocations
    ADD CONSTRAINT pg_certificate_revocations_trust_domain_id_fkey FOREIGN KEY (trust_domain_id) REFERENCES public.pg_ca_trust_domains(id);


--
-- Name: pg_certificate_version_formats pg_certificate_version_formats_certificate_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_version_formats
    ADD CONSTRAINT pg_certificate_version_formats_certificate_version_id_fkey FOREIGN KEY (certificate_version_id) REFERENCES public.pg_certificate_versions(id);


--
-- Name: pg_certificate_version_formats pg_certificate_version_formats_tenant_version_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_version_formats
    ADD CONSTRAINT pg_certificate_version_formats_tenant_version_fk FOREIGN KEY (tenant_id, certificate_version_id) REFERENCES public.pg_certificate_versions(tenant_id, id);


--
-- Name: pg_certificate_version_trust_roots pg_certificate_version_trust_roots_certificate_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_version_trust_roots
    ADD CONSTRAINT pg_certificate_version_trust_roots_certificate_version_id_fkey FOREIGN KEY (certificate_version_id) REFERENCES public.pg_certificate_versions(id);


--
-- Name: pg_certificate_version_trust_roots pg_certificate_version_trust_roots_root_certificate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_version_trust_roots
    ADD CONSTRAINT pg_certificate_version_trust_roots_root_certificate_id_fkey FOREIGN KEY (root_certificate_id) REFERENCES public.pg_root_certificate_records(id);


--
-- Name: pg_certificate_versions pg_certificate_versions_certificate_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_versions
    ADD CONSTRAINT pg_certificate_versions_certificate_asset_id_fkey FOREIGN KEY (certificate_asset_id) REFERENCES public.pg_certificate_assets(id);


--
-- Name: pg_certificate_versions pg_certificate_versions_certificate_profile_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_versions
    ADD CONSTRAINT pg_certificate_versions_certificate_profile_version_id_fkey FOREIGN KEY (certificate_profile_version_id) REFERENCES public.pg_certificate_profile_versions(id);


--
-- Name: pg_certificate_versions pg_certificate_versions_certificate_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_versions
    ADD CONSTRAINT pg_certificate_versions_certificate_request_id_fkey FOREIGN KEY (certificate_request_id) REFERENCES public.pg_certificate_requests(id);


--
-- Name: pg_certificate_versions pg_certificate_versions_issuing_ca_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_versions
    ADD CONSTRAINT pg_certificate_versions_issuing_ca_id_fkey FOREIGN KEY (issuing_ca_id) REFERENCES public.pg_certificate_authorities(id);


--
-- Name: pg_certificate_versions pg_certificate_versions_key_reference_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_versions
    ADD CONSTRAINT pg_certificate_versions_key_reference_id_fkey FOREIGN KEY (key_reference_id) REFERENCES public.pg_key_references(id);


--
-- Name: pg_certificate_versions pg_certificate_versions_tenant_asset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_versions
    ADD CONSTRAINT pg_certificate_versions_tenant_asset_fk FOREIGN KEY (tenant_id, certificate_asset_id) REFERENCES public.pg_certificate_assets(tenant_id, id);


--
-- Name: pg_certificate_versions pg_certificate_versions_trust_domain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_certificate_versions
    ADD CONSTRAINT pg_certificate_versions_trust_domain_id_fkey FOREIGN KEY (trust_domain_id) REFERENCES public.pg_ca_trust_domains(id);


--
-- Name: pg_device_assets pg_device_assets_host_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_device_assets
    ADD CONSTRAINT pg_device_assets_host_id_fkey FOREIGN KEY (host_id) REFERENCES public.pg_hosts(id);


--
-- Name: pg_device_assets pg_device_assets_plugin_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_device_assets
    ADD CONSTRAINT pg_device_assets_plugin_binding_id_fkey FOREIGN KEY (plugin_binding_id) REFERENCES public.unified_plugin_bindings(id);


--
-- Name: pg_device_assets pg_device_assets_plugin_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_device_assets
    ADD CONSTRAINT pg_device_assets_plugin_version_id_fkey FOREIGN KEY (plugin_version_id) REFERENCES public.unified_plugin_versions(id);


--
-- Name: pg_device_assets pg_device_assets_service_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_device_assets
    ADD CONSTRAINT pg_device_assets_service_asset_id_fkey FOREIGN KEY (service_asset_id) REFERENCES public.pg_service_assets(id);


--
-- Name: pg_device_certificate_bindings pg_device_certificate_bindings_certificate_resource_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_device_certificate_bindings
    ADD CONSTRAINT pg_device_certificate_bindings_certificate_resource_id_fkey FOREIGN KEY (certificate_resource_id) REFERENCES public.pg_device_certificate_resources(id);


--
-- Name: pg_device_certificate_bindings pg_device_certificate_bindings_device_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_device_certificate_bindings
    ADD CONSTRAINT pg_device_certificate_bindings_device_asset_id_fkey FOREIGN KEY (device_asset_id) REFERENCES public.pg_device_assets(service_asset_id);


--
-- Name: pg_device_certificate_bindings pg_device_certificate_bindings_virtual_server_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_device_certificate_bindings
    ADD CONSTRAINT pg_device_certificate_bindings_virtual_server_id_fkey FOREIGN KEY (virtual_server_id) REFERENCES public.pg_device_virtual_servers(id);


--
-- Name: pg_device_certificate_resources pg_device_certificate_resources_device_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_device_certificate_resources
    ADD CONSTRAINT pg_device_certificate_resources_device_asset_id_fkey FOREIGN KEY (device_asset_id) REFERENCES public.pg_device_assets(service_asset_id);


--
-- Name: pg_device_virtual_servers pg_device_virtual_servers_device_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_device_virtual_servers
    ADD CONSTRAINT pg_device_virtual_servers_device_asset_id_fkey FOREIGN KEY (device_asset_id) REFERENCES public.pg_device_assets(service_asset_id);


--
-- Name: pg_key_references pg_key_references_rotated_from_key_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_key_references
    ADD CONSTRAINT pg_key_references_rotated_from_key_id_fkey FOREIGN KEY (rotated_from_key_id) REFERENCES public.pg_key_references(id);


--
-- Name: pg_managed_target_snapshots pg_managed_target_snapshots_application_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_managed_target_snapshots
    ADD CONSTRAINT pg_managed_target_snapshots_application_asset_id_fkey FOREIGN KEY (application_asset_id) REFERENCES public.pg_service_assets(id);


--
-- Name: pg_managed_target_snapshots pg_managed_target_snapshots_certificate_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_managed_target_snapshots
    ADD CONSTRAINT pg_managed_target_snapshots_certificate_binding_id_fkey FOREIGN KEY (certificate_binding_id) REFERENCES public.pg_certificate_bindings(id);


--
-- Name: pg_managed_target_snapshots pg_managed_target_snapshots_managed_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_managed_target_snapshots
    ADD CONSTRAINT pg_managed_target_snapshots_managed_target_id_fkey FOREIGN KEY (managed_target_id) REFERENCES public.pg_managed_targets(id);


--
-- Name: pg_managed_target_snapshots pg_managed_target_snapshots_site_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_managed_target_snapshots
    ADD CONSTRAINT pg_managed_target_snapshots_site_asset_id_fkey FOREIGN KEY (site_asset_id) REFERENCES public.pg_site_assets(id);


--
-- Name: pg_managed_targets pg_managed_targets_device_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_managed_targets
    ADD CONSTRAINT pg_managed_targets_device_asset_id_fkey FOREIGN KEY (device_asset_id) REFERENCES public.pg_device_assets(service_asset_id);


--
-- Name: pg_managed_targets pg_managed_targets_host_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_managed_targets
    ADD CONSTRAINT pg_managed_targets_host_id_fkey FOREIGN KEY (device_id) REFERENCES public.pg_hosts(id);


--
-- Name: pg_managed_targets pg_managed_targets_service_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_managed_targets
    ADD CONSTRAINT pg_managed_targets_service_asset_id_fkey FOREIGN KEY (service_asset_id) REFERENCES public.pg_service_assets(id);


--
-- Name: pg_managed_targets pg_managed_targets_service_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_managed_targets
    ADD CONSTRAINT pg_managed_targets_service_instance_id_fkey FOREIGN KEY (framework_instance_id) REFERENCES public.pg_framework_instances(id);


--
-- Name: pg_managed_targets pg_managed_targets_site_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_managed_targets
    ADD CONSTRAINT pg_managed_targets_site_asset_id_fkey FOREIGN KEY (site_id) REFERENCES public.pg_site_assets(id);


--
-- Name: pg_monitor_probe_results pg_monitor_probe_results_monitor_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_monitor_probe_results
    ADD CONSTRAINT pg_monitor_probe_results_monitor_target_id_fkey FOREIGN KEY (monitor_target_id) REFERENCES public.pg_monitor_targets(id);


--
-- Name: pg_monitor_probe_results pg_monitor_probe_results_service_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_monitor_probe_results
    ADD CONSTRAINT pg_monitor_probe_results_service_asset_id_fkey FOREIGN KEY (service_asset_id) REFERENCES public.pg_service_assets(id);


--
-- Name: pg_monitor_targets pg_monitor_targets_service_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_monitor_targets
    ADD CONSTRAINT pg_monitor_targets_service_asset_id_fkey FOREIGN KEY (service_asset_id) REFERENCES public.pg_service_assets(id);


--
-- Name: pg_root_certificate_source_observations pg_root_certificate_source_observation_root_certificate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_root_certificate_source_observations
    ADD CONSTRAINT pg_root_certificate_source_observation_root_certificate_id_fkey FOREIGN KEY (root_certificate_id) REFERENCES public.pg_root_certificate_records(id);


--
-- Name: pg_service_assets pg_service_assets_service_endpoint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_service_assets
    ADD CONSTRAINT pg_service_assets_service_endpoint_id_fkey FOREIGN KEY (service_endpoint_id) REFERENCES public.pg_service_endpoints(id);


--
-- Name: pg_service_assets pg_service_assets_service_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_service_assets
    ADD CONSTRAINT pg_service_assets_service_instance_id_fkey FOREIGN KEY (service_instance_id) REFERENCES public.pg_framework_instances(id);


--
-- Name: pg_service_endpoints pg_service_endpoints_service_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_service_endpoints
    ADD CONSTRAINT pg_service_endpoints_service_instance_id_fkey FOREIGN KEY (service_instance_id) REFERENCES public.pg_framework_instances(id);


--
-- Name: pg_site_assets pg_site_assets_host_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_site_assets
    ADD CONSTRAINT pg_site_assets_host_id_fkey FOREIGN KEY (device_id) REFERENCES public.pg_hosts(id);


--
-- Name: pg_site_assets pg_site_assets_service_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_site_assets
    ADD CONSTRAINT pg_site_assets_service_asset_id_fkey FOREIGN KEY (service_asset_id) REFERENCES public.pg_service_assets(id);


--
-- Name: pg_site_assets pg_site_assets_service_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_site_assets
    ADD CONSTRAINT pg_site_assets_service_instance_id_fkey FOREIGN KEY (framework_instance_id) REFERENCES public.pg_framework_instances(id);


--
-- Name: pg_trust_distributions pg_trust_distributions_ca_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_trust_distributions
    ADD CONSTRAINT pg_trust_distributions_ca_id_fkey FOREIGN KEY (ca_id) REFERENCES public.pg_certificate_authorities(id);


--
-- Name: pg_trust_distributions pg_trust_distributions_trust_domain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pg_trust_distributions
    ADD CONSTRAINT pg_trust_distributions_trust_domain_id_fkey FOREIGN KEY (trust_domain_id) REFERENCES public.pg_ca_trust_domains(id);


--
-- Name: plugin_capability_assignments plugin_capability_assignments_plugin_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_capability_assignments
    ADD CONSTRAINT plugin_capability_assignments_plugin_binding_id_fkey FOREIGN KEY (plugin_binding_id) REFERENCES public.unified_plugin_bindings(id);


--
-- Name: plugin_capability_assignments plugin_capability_assignments_plugin_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_capability_assignments
    ADD CONSTRAINT plugin_capability_assignments_plugin_version_id_fkey FOREIGN KEY (plugin_version_id) REFERENCES public.unified_plugin_versions(id);


--
-- Name: plugin_discovered_certificate_bindings plugin_discovered_certificate_bi_discovered_certificate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_discovered_certificate_bindings
    ADD CONSTRAINT plugin_discovered_certificate_bi_discovered_certificate_id_fkey FOREIGN KEY (discovered_certificate_id) REFERENCES public.plugin_discovered_certificates(id);


--
-- Name: plugin_discovered_certificate_bindings plugin_discovered_certificate_bindings_device_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_discovered_certificate_bindings
    ADD CONSTRAINT plugin_discovered_certificate_bindings_device_asset_id_fkey FOREIGN KEY (device_asset_id) REFERENCES public.pg_device_assets(service_asset_id);


--
-- Name: plugin_discovered_certificate_bindings plugin_discovered_certificate_bindings_managed_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_discovered_certificate_bindings
    ADD CONSTRAINT plugin_discovered_certificate_bindings_managed_target_id_fkey FOREIGN KEY (managed_target_id) REFERENCES public.pg_managed_targets(id);


--
-- Name: plugin_discovered_certificate_bindings plugin_discovered_certificate_bindings_site_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_discovered_certificate_bindings
    ADD CONSTRAINT plugin_discovered_certificate_bindings_site_asset_id_fkey FOREIGN KEY (site_asset_id) REFERENCES public.pg_site_assets(id);


--
-- Name: plugin_discovered_certificate_bindings plugin_discovered_certificate_current_certificate_version__fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_discovered_certificate_bindings
    ADD CONSTRAINT plugin_discovered_certificate_current_certificate_version__fkey FOREIGN KEY (current_certificate_version_id) REFERENCES public.pg_certificate_versions(id);


--
-- Name: plugin_discovered_certificate_bindings plugin_discovered_certificate_desired_certificate_version__fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_discovered_certificate_bindings
    ADD CONSTRAINT plugin_discovered_certificate_desired_certificate_version__fkey FOREIGN KEY (desired_certificate_version_id) REFERENCES public.pg_certificate_versions(id);


--
-- Name: plugin_discovered_certificates plugin_discovered_certificates_certificate_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_discovered_certificates
    ADD CONSTRAINT plugin_discovered_certificates_certificate_version_id_fkey FOREIGN KEY (certificate_version_id) REFERENCES public.pg_certificate_versions(id);


--
-- Name: plugin_discovered_certificates plugin_discovered_certificates_device_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_discovered_certificates
    ADD CONSTRAINT plugin_discovered_certificates_device_asset_id_fkey FOREIGN KEY (device_asset_id) REFERENCES public.pg_device_assets(service_asset_id);


--
-- Name: plugin_discovery_snapshots plugin_discovery_snapshots_device_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_discovery_snapshots
    ADD CONSTRAINT plugin_discovery_snapshots_device_asset_id_fkey FOREIGN KEY (device_asset_id) REFERENCES public.pg_device_assets(service_asset_id);


--
-- Name: plugin_discovery_snapshots plugin_discovery_snapshots_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_discovery_snapshots
    ADD CONSTRAINT plugin_discovery_snapshots_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.pg_hosts(id);


--
-- Name: plugin_discovery_snapshots plugin_discovery_snapshots_plugin_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_discovery_snapshots
    ADD CONSTRAINT plugin_discovery_snapshots_plugin_binding_id_fkey FOREIGN KEY (plugin_binding_id) REFERENCES public.unified_plugin_bindings(id);


--
-- Name: plugin_discovery_snapshots plugin_discovery_snapshots_plugin_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_discovery_snapshots
    ADD CONSTRAINT plugin_discovery_snapshots_plugin_version_id_fkey FOREIGN KEY (plugin_version_id) REFERENCES public.unified_plugin_versions(id);


--
-- Name: plugin_runner_cutover_rejections plugin_runner_cutover_rejections_plugin_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_runner_cutover_rejections
    ADD CONSTRAINT plugin_runner_cutover_rejections_plugin_version_id_fkey FOREIGN KEY (plugin_version_id) REFERENCES public.unified_plugin_versions(id) ON DELETE RESTRICT;


--
-- Name: plugin_runner_version_bindings plugin_runner_version_bindings_plugin_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_runner_version_bindings
    ADD CONSTRAINT plugin_runner_version_bindings_plugin_version_id_fkey FOREIGN KEY (plugin_version_id) REFERENCES public.unified_plugin_versions(id) ON DELETE RESTRICT;


--
-- Name: plugin_workflow_checkpoints plugin_workflow_checkpoints_ledger_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_workflow_checkpoints
    ADD CONSTRAINT plugin_workflow_checkpoints_ledger_id_fkey FOREIGN KEY (ledger_id) REFERENCES public.plugin_workflow_ledgers(id) ON DELETE CASCADE;


--
-- Name: report_runs report_runs_artifact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_runs
    ADD CONSTRAINT report_runs_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.report_artifacts(id);


--
-- Name: risk_events risk_events_certificate_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_events
    ADD CONSTRAINT risk_events_certificate_binding_id_fkey FOREIGN KEY (certificate_binding_id) REFERENCES public.certificate_bindings(id);


--
-- Name: risk_events risk_events_certificate_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_events
    ADD CONSTRAINT risk_events_certificate_version_id_fkey FOREIGN KEY (certificate_version_id) REFERENCES public.certificate_versions(id);


--
-- Name: risk_events risk_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_events
    ADD CONSTRAINT risk_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: risk_status_history risk_status_history_risk_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_status_history
    ADD CONSTRAINT risk_status_history_risk_event_id_fkey FOREIGN KEY (risk_event_id) REFERENCES public.pg_monitor_risk_events(id) ON DELETE CASCADE;


--
-- Name: rollback_plans rollback_plans_execution_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rollback_plans
    ADD CONSTRAINT rollback_plans_execution_run_id_fkey FOREIGN KEY (execution_run_id) REFERENCES public.execution_runs(id);


--
-- Name: rollback_plans rollback_plans_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rollback_plans
    ADD CONSTRAINT rollback_plans_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: service_endpoints service_endpoints_service_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_endpoints
    ADD CONSTRAINT service_endpoints_service_instance_id_fkey FOREIGN KEY (service_instance_id) REFERENCES public.service_instances(id);


--
-- Name: service_endpoints service_endpoints_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_endpoints
    ADD CONSTRAINT service_endpoints_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: service_instances service_instances_host_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_instances
    ADD CONSTRAINT service_instances_host_id_fkey FOREIGN KEY (host_id) REFERENCES public.hosts(id);


--
-- Name: service_instances service_instances_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_instances
    ADD CONSTRAINT service_instances_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: step_results step_results_execution_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.step_results
    ADD CONSTRAINT step_results_execution_step_id_fkey FOREIGN KEY (execution_step_id) REFERENCES public.execution_steps(id);


--
-- Name: step_results step_results_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.step_results
    ADD CONSTRAINT step_results_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: target_capabilities target_capabilities_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.target_capabilities
    ADD CONSTRAINT target_capabilities_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: task_attempts task_attempts_task_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_attempts
    ADD CONSTRAINT task_attempts_task_run_id_fkey FOREIGN KEY (task_run_id) REFERENCES public.task_runs(id) ON DELETE CASCADE;


--
-- Name: task_events task_events_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_events
    ADD CONSTRAINT task_events_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.task_attempts(id) ON DELETE SET NULL;


--
-- Name: task_events task_events_task_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_events
    ADD CONSTRAINT task_events_task_run_id_fkey FOREIGN KEY (task_run_id) REFERENCES public.task_runs(id) ON DELETE CASCADE;


--
-- Name: task_monitor_probes task_monitor_probes_task_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_monitor_probes
    ADD CONSTRAINT task_monitor_probes_task_run_id_fkey FOREIGN KEY (task_run_id) REFERENCES public.task_runs(id) ON DELETE CASCADE;


--
-- Name: task_resource_refs task_resource_refs_task_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_resource_refs
    ADD CONSTRAINT task_resource_refs_task_run_id_fkey FOREIGN KEY (task_run_id) REFERENCES public.task_runs(id) ON DELETE CASCADE;


--
-- Name: task_runs task_runs_parent_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_runs
    ADD CONSTRAINT task_runs_parent_task_id_fkey FOREIGN KEY (parent_task_id) REFERENCES public.task_runs(id);


--
-- Name: tenant_memberships tenant_memberships_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT tenant_memberships_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: unified_plugin_bindings unified_plugin_bindings_plugin_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unified_plugin_bindings
    ADD CONSTRAINT unified_plugin_bindings_plugin_version_id_fkey FOREIGN KEY (plugin_version_id) REFERENCES public.unified_plugin_versions(id);


--
-- Name: unified_plugin_resources unified_plugin_resources_plugin_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unified_plugin_resources
    ADD CONSTRAINT unified_plugin_resources_plugin_version_id_fkey FOREIGN KEY (plugin_version_id) REFERENCES public.unified_plugin_versions(id) ON DELETE RESTRICT;


--
-- Name: unified_plugin_workflow_bindings unified_plugin_workflow_bindings_plugin_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unified_plugin_workflow_bindings
    ADD CONSTRAINT unified_plugin_workflow_bindings_plugin_version_id_fkey FOREIGN KEY (plugin_version_id) REFERENCES public.unified_plugin_versions(id) ON DELETE RESTRICT;


--
-- Name: workflow_runs workflow_runs_execution_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_execution_run_id_fkey FOREIGN KEY (execution_run_id) REFERENCES public.execution_runs(id);


--
-- Name: workflow_runs workflow_runs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_runs workflow_runs_workflow_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_workflow_template_id_fkey FOREIGN KEY (workflow_template_id) REFERENCES public.workflow_templates(id);


--
-- Name: workflow_templates workflow_templates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_templates
    ADD CONSTRAINT workflow_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- PostgreSQL database dump complete
--

SET search_path = public;

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.8 (Debian 16.8-1.pgdg120+1)
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', 'public', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: risk_sla_policies; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.risk_sla_policies (id, tenant_id, version, severity, acknowledgement_seconds, resolution_seconds, effective_from, effective_to, created_by, created_at) VALUES ('sla_default_v1_low', 'dd43c28b-7411-4a45-9497-5547e2f1c8b8', 1, 'low', 86400, 604800, '2026-07-21 08:00:00+08', NULL, 'system', '2026-07-22 09:16:22.816245+08');
INSERT INTO public.risk_sla_policies (id, tenant_id, version, severity, acknowledgement_seconds, resolution_seconds, effective_from, effective_to, created_by, created_at) VALUES ('sla_default_v1_medium', 'dd43c28b-7411-4a45-9497-5547e2f1c8b8', 1, 'medium', 14400, 172800, '2026-07-21 08:00:00+08', NULL, 'system', '2026-07-22 09:16:22.816245+08');
INSERT INTO public.risk_sla_policies (id, tenant_id, version, severity, acknowledgement_seconds, resolution_seconds, effective_from, effective_to, created_by, created_at) VALUES ('sla_default_v1_high', 'dd43c28b-7411-4a45-9497-5547e2f1c8b8', 1, 'high', 3600, 86400, '2026-07-21 08:00:00+08', NULL, 'system', '2026-07-22 09:16:22.816245+08');
INSERT INTO public.risk_sla_policies (id, tenant_id, version, severity, acknowledgement_seconds, resolution_seconds, effective_from, effective_to, created_by, created_at) VALUES ('sla_default_v1_critical', 'dd43c28b-7411-4a45-9497-5547e2f1c8b8', 1, 'critical', 900, 14400, '2026-07-21 08:00:00+08', NULL, 'system', '2026-07-22 09:16:22.816245+08');


--
-- Data for Name: system_initialization_state; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.system_initialization_state (id, status, claim_token, initialized_at, updated_at) VALUES ('singleton', 'PENDING', NULL, NULL, '2026-08-23 14:37:14.605244+08');


--
-- Data for Name: tenants; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.tenants (id, name, code, status, settings, created_at, updated_at, deleted_at, created_by, updated_by, version, tenant_type, parent_id) VALUES ('dd43c28b-7411-4a45-9497-5547e2f1c8b8', '默认租户', 'default', 'ACTIVE', '{"deploymentTasks": {"dryRunEnabled": false, "approvalEnabled": false}}', '2026-08-05 23:26:53.634624+08', '2026-08-22 20:20:02.234537+08', NULL, NULL, NULL, 4, 'GROUP', NULL);


--
-- Data for Name: tenant_memberships; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.tenant_memberships (id, subject_type, subject_id, tenant_id, membership_type, status, effective_from, effective_until, created_at, updated_at, created_by, updated_by, revoked_at, revoked_by, version, expired_at) VALUES ('33a426cc-9564-4fea-9a78-416f476fb6e8', 'user', 'user_admin', 'dd43c28b-7411-4a45-9497-5547e2f1c8b8', 'owner', 'ACTIVE', '2026-08-05 23:39:08.386184+08', NULL, '2026-08-05 23:39:08.386184+08', '2026-08-05 23:39:08.386184+08', 'system_migration', NULL, NULL, NULL, 1, NULL);


--
-- PostgreSQL database dump complete
--
