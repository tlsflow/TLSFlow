create table if not exists pg_ca_node_request_nonces (
  node_id text not null references pg_ca_nodes(id) on delete cascade,
  nonce text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (node_id, nonce)
);

create index if not exists idx_pg_ca_node_request_nonces_expiry
  on pg_ca_node_request_nonces (expires_at);
