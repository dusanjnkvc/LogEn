-- Run against a dedicated development Supabase project after migration 001.
-- This transaction creates synthetic test users and rolls everything back.
begin;
select set_config('logen.test.alice',gen_random_uuid()::text,true);
select set_config('logen.test.bob',gen_random_uuid()::text,true);
insert into auth.users(id,email,aud,role) values
 (current_setting('logen.test.alice')::uuid,current_setting('logen.test.alice')||'@logen-test.invalid','authenticated','authenticated'),
 (current_setting('logen.test.bob')::uuid,current_setting('logen.test.bob')||'@logen-test.invalid','authenticated','authenticated');

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('logen.test.alice'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('logen.test.alice'),'role','authenticated')::text,true);
select public.save_logen_record('workspace','{"owner":"alice"}',0);
insert into storage.objects(bucket_id,name) values('logen-private',current_setting('logen.test.alice')||'/test-drawing');
do $$ begin
 if (select count(*) from storage.objects where bucket_id='logen-private')<>1 then raise exception 'Alice cannot read her file';end if;
end $$;
do $$ begin
 if (select count(*) from public.logen_records)<>1 then raise exception 'Alice cannot read her own record'; end if;
 begin perform public.save_logen_record('workspace','{"stale":true}',0);raise exception 'A stale revision was accepted';exception when sqlstate 'PT409' then null;end;
end $$;

select set_config('request.jwt.claim.sub',current_setting('logen.test.bob'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('logen.test.bob'),'role','authenticated')::text,true);
do $$ declare affected integer;begin
 if (select count(*) from public.logen_records)<>0 then raise exception 'Bob can read Alice data'; end if;
 if exists(select 1 from storage.objects where bucket_id='logen-private') then raise exception 'Bob can read Alice files';end if;
 update storage.objects set metadata='{"forged":true}' where bucket_id='logen-private' and name=current_setting('logen.test.alice')||'/test-drawing';
 get diagnostics affected=row_count;if affected<>0 then raise exception 'Bob updated Alice file';end if;
 begin
  insert into storage.objects(bucket_id,name) values('logen-private',current_setting('logen.test.alice')||'/forged');
  raise exception 'Bob inserted an Alice file';
 exception when insufficient_privilege then null;end;
 update public.logen_records set payload='{"forged":true}' where user_id=current_setting('logen.test.alice')::uuid;
 get diagnostics affected=row_count;if affected<>0 then raise exception 'Bob updated Alice data';end if;
 delete from public.logen_records where user_id=current_setting('logen.test.alice')::uuid;
 get diagnostics affected=row_count;if affected<>0 then raise exception 'Bob deleted Alice data';end if;
 begin
  insert into public.logen_records(user_id,record_key,payload) values(current_setting('logen.test.alice')::uuid,'forged','{}');
  raise exception 'Bob inserted an Alice-owned record';
 exception when insufficient_privilege then null;end;
end $$;
select public.save_logen_record('workspace','{"owner":"bob"}',0);
do $$ begin
 if (select count(*) from public.logen_records)<>1 then raise exception 'Bob sees the wrong record count';end if;
 if (select payload->>'owner' from public.logen_records where record_key='workspace')<>'bob' then raise exception 'Bob read another owner';end if;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$ begin
 begin perform * from public.logen_records;raise exception 'Anonymous read was accepted';exception when insufficient_privilege then null;end;
 begin perform public.save_logen_record('workspace','{}',0);raise exception 'Anonymous save was accepted';exception when insufficient_privilege then null;end;
end $$;
rollback;
