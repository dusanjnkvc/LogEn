create or replace function public.save_logen_record(p_key text, p_payload jsonb, p_revision bigint)
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
  if affected = 0 then raise exception 'Project changed on another device. Reload before saving.' using errcode = 'PT409'; end if;
end;
$$;
