-- Pending deployment: apply only to the Supabase project selected for LogEn.
-- All application ownership comes from the authenticated JWT, never a username.
begin;
create table public.logen_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_key text not null check (char_length(record_key) between 1 and 512),
  payload jsonb not null check (octet_length(payload::text) <= 10485760),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, record_key)
);
alter table public.logen_records enable row level security;
revoke all on public.logen_records from anon, authenticated;
grant select, insert, update, delete on public.logen_records to authenticated;
create policy logen_records_owner on public.logen_records for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Compare-and-swap prevents one device silently replacing another device's edits.
create function public.save_logen_record(p_key text, p_payload jsonb, p_revision bigint)
returns setof public.logen_records language plpgsql security invoker set search_path = '' as $$
declare caller uuid := auth.uid(); affected integer;
begin
  if caller is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_revision is null or p_revision < 0 then raise exception 'Invalid revision' using errcode = '22023'; end if;
  if p_revision = 0 then
    return query insert into public.logen_records(user_id,record_key,payload)
      values(caller,p_key,p_payload) on conflict do nothing returning *;
  else
    return query update public.logen_records set payload=p_payload,revision=revision+1,updated_at=now()
      where user_id=caller and record_key=p_key and revision=p_revision returning *;
  end if;
  get diagnostics affected = row_count;
  if affected = 0 then raise exception 'Project changed on another device. Reload before saving.' using errcode = '40001'; end if;
end;
$$;
revoke all on function public.save_logen_record(text,jsonb,bigint) from public, anon;
grant execute on function public.save_logen_record(text,jsonb,bigint) to authenticated;

-- Drawings, PDFs and large snapshots stay private, including their download URLs.
insert into storage.buckets(id,name,public,file_size_limit)
values('logen-private','logen-private',false,104857600);
create policy logen_files_owner_read on storage.objects for select to authenticated
  using (bucket_id='logen-private' and (storage.foldername(name))[1]=(select auth.uid()::text));
create policy logen_files_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id='logen-private' and (storage.foldername(name))[1]=(select auth.uid()::text));
create policy logen_files_owner_update on storage.objects for update to authenticated
  using (bucket_id='logen-private' and (storage.foldername(name))[1]=(select auth.uid()::text))
  with check (bucket_id='logen-private' and (storage.foldername(name))[1]=(select auth.uid()::text));
create policy logen_files_owner_delete on storage.objects for delete to authenticated
  using (bucket_id='logen-private' and (storage.foldername(name))[1]=(select auth.uid()::text));
commit;
