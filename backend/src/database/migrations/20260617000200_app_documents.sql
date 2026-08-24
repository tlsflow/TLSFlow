create table if not exists app_documents (
  namespace varchar(128) not null,
  document_id varchar(128) not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (namespace, document_id)
);

create index if not exists idx_app_documents_namespace_updated
  on app_documents (namespace, updated_at desc);
