-- The reference Class D pipe — data layer (BP-02). Postgres + row-level security.
--
-- The laws live here, not in prompts or UI (BP-02 §1). This file is the data-layer half of
-- the BP-02 §8 checklist; the git history of reference/ adds it point by point so the build
-- order teaches itself. Two roles: the pipe connects as the table owner for privileged
-- ingest/purge/vault work, and SET LOCAL ROLE brain_app per read so row-level security is
-- enforced against a non-owner exactly as a member or peer would hit it.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
-- brain_app is the client-facing role: every queryAs runs under it so RLS bites. It can read
-- and write the record tables (RLS-gated) but may only SELECT/INSERT the journal (append-only,
-- BP-02 §3.4) and has NO access to the vault (BP-02 §4).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'brain_app') then
    create role brain_app nologin;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Members and the lens resolution (BP-02 §3.1)
-- ---------------------------------------------------------------------------
create table member (
  id    text primary key,
  role  text not null check (role in ('adult', 'child')),
  label text
);

create table partnership (
  a text not null references member(id),
  b text not null references member(id),
  primary key (a, b)
);

-- current member resolves from the session GUC app.member, never a client-supplied row value
-- (BP-02 §3.1). Empty/unset ⇒ NULL ⇒ an anonymous / foreign / service-role context.
create function current_member_id() returns text language sql stable as $$
  select nullif(current_setting('app.member', true), '')
$$;
create function is_member(m text) returns boolean language sql stable security definer as $$
  select exists (select 1 from member where id = m)
$$;
create function is_adult(m text) returns boolean language sql stable security definer as $$
  select exists (select 1 from member where id = m and role = 'adult')
$$;
create function is_partner_of(owner_m text, viewer_m text) returns boolean language sql stable security definer as $$
  select exists (
    select 1 from partnership
    where (a = owner_m and b = viewer_m) or (a = viewer_m and b = owner_m)
  )
$$;

-- ---------------------------------------------------------------------------
-- The four primitives. Each row stores the full BP-01 envelope in `doc` (so export is
-- byte-faithful and unknown fields/subtypes/urns round-trip — T-ENV-05/08/09), plus extracted
-- columns for RLS and query. `connection` tags the row's origin for the forget purge (BP-02 §5).
-- ---------------------------------------------------------------------------
create table entity (
  id           text primary key,
  owner        text,
  visibility   text not null,
  sensitivity  text not null,
  source       text not null,
  external_ref text,
  state        text,
  origin_chain text[] not null default '{}',
  provenance   text[] not null default '{}',
  connection   text,
  doc          jsonb not null,
  unique (source, external_ref)
);

create table activity (
  id           text primary key,
  owner        text,
  visibility   text not null,
  sensitivity  text not null,
  source       text not null,
  external_ref text,
  state        text not null,
  origin_chain text[] not null default '{}',
  provenance   text[] not null default '{}',
  connection   text,
  doc          jsonb not null,
  unique (source, external_ref)
);

create table edge (
  id           text primary key,
  owner        text,
  visibility   text not null,
  sensitivity  text not null,
  source       text not null,
  subject_urn  text not null,
  object_urn   text not null,
  origin_chain text[] not null default '{}',
  provenance   text[] not null default '{}',
  connection   text,
  doc          jsonb not null
);

create table action (
  id           text primary key,
  owner        text,
  visibility   text not null,
  sensitivity  text not null,
  source       text not null,
  external_ref text,
  state        text not null,
  origin_chain text[] not null default '{}',
  provenance   text[] not null default '{}',
  connection   text,
  doc          jsonb not null,
  unique (source, external_ref)
);

-- Derived memory store (BP-06 lite): a provenance-bearing derived store the forget audit must
-- also reach, so forget-to-zero is proven across derived data (BP-02 §5.3, T-DAT-04).
create table derived_memory (
  id          text primary key,
  owner       text,
  visibility  text not null,
  sensitivity text not null,
  source      text not null default 'derived',
  provenance  text[] not null,
  connection  text,
  doc         jsonb not null,
  state       text not null default 'active'
);

-- ---------------------------------------------------------------------------
-- Provenance totality (BP-02 §3.3, point 4): a derived write without attributable provenance
-- is rejected at the storage layer — not logged and accepted.
-- ---------------------------------------------------------------------------
alter table entity   add constraint entity_provenance_totality
  check (not (source in ('derived', 'agent-inference') and coalesce(array_length(provenance, 1), 0) = 0));
alter table activity add constraint activity_provenance_totality
  check (not (source in ('derived', 'agent-inference') and coalesce(array_length(provenance, 1), 0) = 0));
alter table derived_memory add constraint dm_provenance_totality
  check (coalesce(array_length(provenance, 1), 0) > 0);

-- ---------------------------------------------------------------------------
-- The children's wall (BP-02 §3.1, point 3): anything owned by a child is forced to
-- shared:household at write time — a trigger, not application courtesy.
-- ---------------------------------------------------------------------------
create function force_child_household() returns trigger language plpgsql as $$
begin
  if new.owner is not null and exists (select 1 from member where id = new.owner and role = 'child') then
    new.visibility := 'shared:household';
  end if;
  return new;
end $$;
create trigger entity_child_wall   before insert or update on entity   for each row execute function force_child_household();
create trigger activity_child_wall before insert or update on activity for each row execute function force_child_household();

-- ---------------------------------------------------------------------------
-- The visibility law (BP-02 §3.1): row-level security, deny by default. A query as a member
-- physically cannot return rows above their sight. No insert/update/delete policy on reads is
-- needed because writes go through the owner role; brain_app reads through these SELECT policies.
-- ---------------------------------------------------------------------------
alter table entity   enable row level security;  alter table entity   force row level security;
alter table activity enable row level security;  alter table activity force row level security;
alter table edge     enable row level security;  alter table edge     force row level security;
alter table action   enable row level security;  alter table action   force row level security;

-- The reusable visibility predicate, applied per table.
create policy entity_select on entity for select using (
  owner = current_member_id()
  or (visibility = 'shared:partners'  and is_partner_of(owner, current_member_id()))
  or (visibility = 'shared:adults'    and is_adult(current_member_id()))
  or (visibility = 'shared:household' and is_member(current_member_id()))
  or (visibility = 'public'           and is_member(current_member_id()))
);
create policy activity_select on activity for select using (
  owner = current_member_id()
  or (visibility = 'shared:partners'  and is_partner_of(owner, current_member_id()))
  or (visibility = 'shared:adults'    and is_adult(current_member_id()))
  or (visibility = 'shared:household' and is_member(current_member_id()))
  or (visibility = 'public'           and is_member(current_member_id()))
);
-- Edges inherit the stricter endpoint's audience; for the reference, an edge is visible only
-- when its own stamped visibility admits the viewer (the pipe stamps it at or below both ends).
create policy edge_select on edge for select using (
  owner = current_member_id()
  or (visibility = 'shared:partners'  and is_partner_of(owner, current_member_id()))
  or (visibility = 'shared:adults'    and is_adult(current_member_id()))
  or (visibility = 'shared:household' and is_member(current_member_id()))
  or (visibility = 'public'           and is_member(current_member_id()))
);
create policy action_select on action for select using (
  owner = current_member_id()
  or (visibility = 'shared:partners'  and is_partner_of(owner, current_member_id()))
  or (visibility = 'shared:adults'    and is_adult(current_member_id()))
  or (visibility = 'shared:household' and is_member(current_member_id()))
  or (visibility = 'public'           and is_member(current_member_id()))
);

grant select on entity, activity, edge, action, derived_memory to brain_app;

-- ---------------------------------------------------------------------------
-- The journal of side-effects (BP-02 §3.4, point 5): append-only. brain_app may SELECT/INSERT
-- but never UPDATE/DELETE — immutability enforced by privilege, so T-DAT-09 sees a real refusal.
-- ---------------------------------------------------------------------------
create table journal (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      text not null,
  verb       text not null,
  object_urn text not null,
  source     text not null,
  connection text,
  detail     jsonb
);
grant select, insert on journal to brain_app;
-- (no update/delete grant to brain_app — append-only)

-- The local per-exchange audit log (BP-02 §6, CD-3): metadata only, never payload bodies.
create table audit_log (
  exchange_id    text primary key,
  grant_id       text,
  peer           text,
  direction      text,
  method         text,
  at             timestamptz not null default now(),
  outcome        text,
  counts         jsonb,
  classes_present text[],
  signature_valid boolean
);
grant select, insert on audit_log to brain_app;

-- ---------------------------------------------------------------------------
-- The vault (BP-02 §4, point 6): secrets server-side only, zero client read paths. brain_app
-- gets NOTHING on this schema. Access is exclusively via security-definer functions that verify
-- or use the secret and never return it. The stored form is a hash, never plaintext.
-- ---------------------------------------------------------------------------
create schema vault;
revoke all on schema vault from public;

create table vault.secret (
  id            uuid primary key default gen_random_uuid(),
  connection    text not null,
  secret_hash   text not null,        -- verify-only; value shown once at mint
  expires_at    timestamptz not null,
  revoked_at    timestamptz
);
-- brain_app is granted no privileges here: no select path exists for any client role.

-- Mint a secret: store only its hash, return nothing (the caller already holds the cleartext
-- it generated). Security definer so it runs as the owner, but it never returns the secret.
create function vault.store_secret(p_connection text, p_hash text, p_expires timestamptz)
  returns void language sql security definer as $$
  insert into vault.secret (connection, secret_hash, expires_at) values (p_connection, p_hash, p_expires)
$$;
-- Verify a presented secret without returning anything but a boolean.
create function vault.verify_secret(p_connection text, p_hash text)
  returns boolean language sql security definer as $$
  select exists (
    select 1 from vault.secret
    where connection = p_connection and secret_hash = p_hash
      and revoked_at is null and expires_at > now()
  )
$$;
create function vault.destroy_secrets(p_connection text)
  returns integer language sql security definer as $$
  with d as (update vault.secret set revoked_at = now() where connection = p_connection and revoked_at is null returning 1)
  select count(*)::int from d
$$;
revoke all on function vault.store_secret(text, text, timestamptz) from public;
revoke all on function vault.verify_secret(text, text) from public;
revoke all on function vault.destroy_secrets(text) from public;
