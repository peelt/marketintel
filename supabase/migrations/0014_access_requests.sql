-- ============================================================
-- 0014 — Access requests (public "register" form)
--
-- The public login page gains a request-access form. Requests land
-- here AND notify info@ via Postmark — the table is the durable
-- record (an email can be missed; a row can't), reviewed manually
-- in the dashboard when granting access (seed app_users + invite).
--
-- Surface is write-only from the API: anon/authenticated may INSERT
-- (that's the public form), nobody may SELECT/UPDATE/DELETE — reads
-- happen in the Supabase dashboard with the service role. Shape is
-- enforced in the DATABASE (checks + unique), not just app code:
-- the anon key is public, so the table must defend itself.
-- ============================================================

create table public.access_requests (
    id uuid primary key default gen_random_uuid(),
    email text not null unique
        check (char_length(email) between 6 and 320 and position('@' in email) > 1),
    note text
        check (note is null or char_length(note) <= 500),
    created_at timestamptz not null default now()
);

alter table public.access_requests enable row level security;

-- Public form: insert-only. No select/update/delete policies exist, so the
-- API can write a request but never read the list back.
create policy "anyone may request access"
    on public.access_requests
    for insert
    to anon, authenticated
    with check (true);
