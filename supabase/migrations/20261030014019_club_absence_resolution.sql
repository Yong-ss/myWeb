-- Additive: existing absence decisions and snapshot revisions remain intact.
alter table public.club_snapshot_absences add column reason text;
alter table public.club_snapshot_absences drop constraint club_snapshot_absences_decision_check;
alter table public.club_snapshot_absences add constraint club_snapshot_absences_decision_check check(decision in ('left','temporary','missed','uncertain'));
alter table public.club_snapshot_absences add constraint club_absence_reason_check check ((decision='temporary' and reason is not null and length(btrim(reason)) between 1 and 500 and reason !~ '[[:cntrl:]]') or (decision<>'temporary' and reason is null));

create or replace function club_private.commit_import(
  p_club_id uuid, p_date date, p_complete boolean, p_mode text, p_rows jsonb,
  p_raw text, p_request_id uuid, p_expected uuid, p_confirmed boolean, p_absences jsonb, p_baseline uuid, p_review boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  previous public.club_snapshots%rowtype;
  replay record;
  row_data jsonb;
  field_name text;
  player uuid;
  resolved jsonb := '[]'::jsonb;
  mappings jsonb := '[]'::jsonb;
  request_hash text;
  content_hash text;
  import_id uuid := gen_random_uuid();
  snapshot_id uuid := gen_random_uuid();
  next_revision integer; old_name text; new_name text; baseline_id uuid; candidates jsonb; decision_ids uuid[]; expected_ids uuid[]; submitted_absences jsonb := p_absences;
begin
  if actor is null or not exists(select 1 from auth.users where id = actor and email_confirmed_at is not null) then
    raise exception using errcode='42501', message='请先登录已确认邮箱的账户';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club_id::text, 0));
  perform 1 from public.club_memberships where club_id=p_club_id and user_id=actor and status='active' and role in ('owner','admin') for share;
  if not found then raise exception using errcode='42501', message='没有此俱乐部的导入权限'; end if;
  if p_confirmed is distinct from true or p_date is null or p_date < date '2000-01-01' or p_date > date '2100-12-31'
    or p_complete is null or p_mode is null or p_mode not in ('merge','replace') or p_request_id is null
    or p_raw is null or octet_length(p_raw) not between 1 and 131072 then
    raise exception using errcode='22023', message='日期、原始输入或人工确认无效';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception using errcode='22023', message='玩家列表无效'; end if;
  if jsonb_array_length(p_rows) not between 1 and 200 then raise exception using errcode='22023', message='每批需要 1～200 名玩家'; end if;
  request_hash := encode(sha256(convert_to((jsonb_build_object('date',p_date,'complete',p_complete,'mode',p_mode,'rows',p_rows,'raw',p_raw,'expected',p_expected)||case when p_review then jsonb_build_object('absences',p_absences,'baseline',p_baseline) else '{}'::jsonb end)::text,'UTF8')),'hex');
  select i.request_hash, s.id, s.revision, s.deleted_at into replay from public.club_imports i join public.club_snapshots s on s.club_id=i.club_id and s.import_id=i.id where i.club_id=p_club_id and i.request_id=p_request_id;
  if found then
    if replay.deleted_at is not null then raise exception using errcode='PT409', message='此导入已删除，请重新准备数据'; end if;
    if replay.request_hash is distinct from request_hash then raise exception using errcode='22023', message='此提交编号已用于其他内容，请重新预览'; end if;
    return jsonb_build_object('snapshot_id',replay.id,'revision',replay.revision,'replayed',true,'unchanged',false);
  end if;
  select * into previous from public.club_snapshots where club_id=p_club_id and snapshot_date=p_date and is_current for update;
  if (case when previous.deleted_at is null then previous.id else null end) is distinct from p_expected then raise exception using errcode='PT409', message='同日数据已变化，请重新载入并确认预览'; end if;

  if jsonb_typeof(p_absences) is distinct from 'array' or jsonb_array_length(p_absences)>1000 then raise exception using errcode='22023',message='缺席核对资料无效'; end if;
  select id into baseline_id from public.club_snapshots where club_id=p_club_id and is_current and deleted_at is null and snapshot_date<=p_date order by snapshot_date desc limit 1;
  if p_review and baseline_id is distinct from p_baseline then raise exception using errcode='PT409',message='对比名单已变化，请重新准备数据'; end if;
  if not p_review and previous.id is not null and exists(select 1 from public.club_snapshot_absences a where a.club_id=p_club_id and a.snapshot_id=previous.id) then raise exception using errcode='PT409',message='请使用最新页面重新核对缺席成员'; end if;
  -- Corrections participate in the existing request hash, lock and transaction.
  -- A failed import rolls every correction and audit entry back.
  for row_data in select value from jsonb_array_elements(p_rows) where value ? 'correct_name' or value ? 'expected_name' loop
    new_name := btrim(row_data->>'correct_name');
    if row_data->'identity_confirmed' is distinct from 'true'::jsonb or jsonb_typeof(row_data->'player_id') is distinct from 'string'
      or jsonb_typeof(row_data->'correct_name') is distinct from 'string' or jsonb_typeof(row_data->'expected_name') is distinct from 'string'
      or new_name is null or length(new_name) not between 1 and 200 or new_name ~ '[[:cntrl:]]'
      or length(row_data->>'expected_name') not between 1 and 200 or row_data->>'name' is distinct from new_name then
      raise exception using errcode='22023',message='请明确确认已有玩家和正确昵称';
    end if;
    player := (row_data->>'player_id')::uuid;
    select display_name into old_name from public.club_players where club_id=p_club_id and id=player for update;
    if not found then raise exception using errcode='42501',message='所选玩家不属于当前俱乐部'; end if;
    if old_name is distinct from row_data->>'expected_name' then raise exception using errcode='PT409',message='玩家昵称已被修改，请重新准备并核对'; end if;
    if old_name is distinct from new_name then
      if exists(select 1 from public.club_players p where p.club_id=p_club_id and p.id<>player and btrim(p.display_name)=new_name)
        or exists(select 1 from public.club_player_aliases a where a.club_id=p_club_id and a.player_id<>player and a.revoked_at is null and a.alias_name=new_name) then
        raise exception using errcode='PT409',message='这个昵称已属于其他玩家，请重新核对身份';
      end if;
      update public.club_players set display_name=new_name,match_name=regexp_replace(new_name,'[[:space:]、丶·]','','g') where club_id=p_club_id and id=player;
      insert into public.club_audit_events(club_id,actor_id,action,target_id,details) values
        (p_club_id,actor,'player_renamed',player,jsonb_build_object('old_name',old_name,'new_name',new_name,'date',p_date));
    end if;
  end loop;
  for row_data in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(row_data) is distinct from 'object' then raise exception using errcode='22023', message='玩家记录必须是对象'; end if;
    if not (row_data ?& array['name','position','level','pathway','extraordinary_score','prosperity','weekly_activity','group','join_days','player_id'])
      or exists(select 1 from jsonb_object_keys(row_data) k where k not in ('name','position','level','pathway','extraordinary_score','prosperity','weekly_activity','group','join_days','player_id','source_name','remember_alias','identity_confirmed','correct_name','expected_name')) then
      raise exception using errcode='22023', message='玩家记录字段不完整或包含额外字段';
    end if;
    foreach field_name in array array['name','position','pathway','group'] loop
      if row_data->field_name <> 'null'::jsonb and (jsonb_typeof(row_data->field_name) <> 'string' or length(btrim(row_data->>field_name)) not between 1 and 200) then
        raise exception using errcode='22023', message='玩家文字字段格式无效';
      end if;
    end loop;
    foreach field_name in array array['level','extraordinary_score','prosperity','weekly_activity','join_days'] loop
      if row_data->field_name <> 'null'::jsonb then
        if jsonb_typeof(row_data->field_name) <> 'number' then raise exception using errcode='22023', message='数值必须是整数或 null'; end if;
        if (row_data->>field_name)::numeric < 0 or (row_data->>field_name)::numeric > 9007199254740991
          or trunc((row_data->>field_name)::numeric) <> (row_data->>field_name)::numeric
          or (field_name in ('level','join_days') and (row_data->>field_name)::numeric > 2147483647) then
          raise exception using errcode='22023', message='数值超出非负整数范围';
        end if;
      end if;
    end loop;
    if (row_data ? 'source_name' and row_data->'source_name' <> 'null'::jsonb and (jsonb_typeof(row_data->'source_name') <> 'string' or length(row_data->>'source_name') > 200))
      or (row_data ? 'identity_confirmed' and jsonb_typeof(row_data->'identity_confirmed') <> 'boolean')
      or (row_data ? 'remember_alias' and jsonb_typeof(row_data->'remember_alias') <> 'boolean') then
      raise exception using errcode='22023', message='身份确认资料无效';
    end if;
    if row_data->'identity_confirmed' = 'false'::jsonb then
      if row_data->'player_id' = 'null'::jsonb or
        (select count(distinct p.id) from public.club_players p where p.club_id=p_club_id and
          (btrim(p.display_name)=btrim(row_data->>'name') or exists(select 1 from public.club_player_aliases a where a.club_id=p_club_id and a.player_id=p.id and a.revoked_at is null and a.alias_name=btrim(row_data->>'name')))) <> 1
        or not exists(select 1 from public.club_players p where p.club_id=p_club_id and p.id=(row_data->>'player_id')::uuid and
          (btrim(p.display_name)=btrim(row_data->>'name') or exists(select 1 from public.club_player_aliases a where a.club_id=p_club_id and a.player_id=p.id and a.revoked_at is null and a.alias_name=btrim(row_data->>'name')))) then
        raise exception using errcode='PT409', message='自动身份匹配已变化或存在冲突，请重新核对';
      end if;
    end if;
    if (select count(*) from jsonb_array_elements(p_rows) r where btrim(r->>'name')=btrim(row_data->>'name')) > 1
       and row_data->'identity_confirmed' is distinct from 'true'::jsonb then
      raise exception using errcode='22023', message='同批重复昵称必须逐一确认同名不同人或移除重复行';
    end if;
    if row_data->'player_id' = 'null'::jsonb then
      if row_data->'name' = 'null'::jsonb then raise exception using errcode='22023', message='新玩家必须先确认昵称'; end if;
      player := gen_random_uuid();
      insert into public.club_players(id,club_id,display_name,match_name)
        values(player,p_club_id,row_data->>'name',regexp_replace(row_data->>'name','[[:space:]、丶·]','','g'));
    else
      if jsonb_typeof(row_data->'player_id') <> 'string' then raise exception using errcode='22023', message='必须人工选择玩家身份'; end if;
      player := (row_data->>'player_id')::uuid;
      perform 1 from public.club_players where club_id=p_club_id and id=player for share;
      if not found then raise exception using errcode='42501', message='所选玩家不属于当前俱乐部'; end if;
    end if;
    if exists(select 1 from jsonb_array_elements(resolved) x where x->>'player_id'=player::text) then
      raise exception using errcode='22023', message='多行指向同一玩家，请先修正冲突';
    end if;
    if row_data->'remember_alias' = 'true'::jsonb then
      if row_data->'identity_confirmed' is distinct from 'true'::jsonb or nullif(btrim(row_data->>'source_name'),'') is null then
        raise exception using errcode='22023', message='记住别名前必须明确确认身份和原始昵称';
      end if;
      perform club_private.manage_alias(p_club_id,player,btrim(row_data->>'source_name'),null);
    end if;
    resolved := resolved || jsonb_build_array((row_data - 'remember_alias' - 'identity_confirmed' - 'correct_name' - 'expected_name') || jsonb_build_object('player_id',player,'source_name',case when row_data ? 'source_name' then row_data->'source_name' else row_data->'name' end));
    mappings := mappings || jsonb_build_array(jsonb_build_object('row',jsonb_array_length(mappings)+1,'player_id',player));
  end loop;
  -- Remembering another row's alias must not invalidate an earlier automatic choice.
  for row_data in select value from jsonb_array_elements(p_rows) where value->'identity_confirmed'='false'::jsonb loop
    if (select count(distinct p.id) from public.club_players p where p.club_id=p_club_id and
      (btrim(p.display_name)=btrim(row_data->>'name') or exists(select 1 from public.club_player_aliases a where a.club_id=p_club_id and a.player_id=p.id and a.revoked_at is null and a.alias_name=btrim(row_data->>'name')))) <> 1 then
      raise exception using errcode='PT409', message='本批确认别名与自动匹配冲突，请逐一确认身份';
    end if;
  end loop;
  if p_mode='merge' and previous.id is not null and previous.deleted_at is null then
    select resolved || coalesce(jsonb_agg((to_jsonb(s) - 'club_id' - 'snapshot_id' - 'group_name') || jsonb_build_object('group',s.group_name)), '[]'::jsonb)
      into resolved from public.club_snapshot_players s where s.club_id=p_club_id and s.snapshot_id=previous.id
      and not exists(select 1 from jsonb_array_elements(resolved) x where x->>'player_id'=s.player_id::text);
  end if;
  if jsonb_array_length(resolved)>200 then raise exception using errcode='22023', message='合并后的名单超过 200 人'; end if;
  if p_review then
    candidates:=public.club_absence_context(p_club_id,p_date)->'members';
    select coalesce(array_agg((c->>'player_id')::uuid order by c->>'player_id'),'{}'::uuid[]) into expected_ids
      from jsonb_array_elements(candidates) c where not exists(select 1 from jsonb_array_elements(resolved) r where r->>'player_id'=c->>'player_id');
    if exists(select 1 from jsonb_array_elements(p_absences) a where jsonb_typeof(a) is distinct from 'object' or (a - 'player_id' - 'decision' - 'reason') <> '{}'::jsonb or jsonb_typeof(a->'player_id') is distinct from 'string' or a->>'decision' is null or a->>'decision' not in ('left','temporary','missed','uncertain') or (a->>'decision'='temporary' and (jsonb_typeof(a->'reason') is distinct from 'string' or length(btrim(a->>'reason')) not between 1 and 500)) or (a->>'decision'<>'temporary' and a ? 'reason') or (a ? 'reason' and (jsonb_typeof(a->'reason') is distinct from 'string' or length(a->>'reason')>500 or a->>'reason' ~ '[[:cntrl:]]'))) then raise exception using errcode='22023',message='请逐一核对缺席成员'; end if;
    select coalesce(array_agg((a->>'player_id')::uuid order by a->>'player_id'),'{}'::uuid[]) into decision_ids from jsonb_array_elements(p_absences) a;
    if decision_ids is distinct from expected_ids then raise exception using errcode='PT409',message='缺席名单与本次玩家不一致，请重新核对'; end if;
    if p_complete and exists(select 1 from jsonb_array_elements(p_absences) a where a->>'decision' not in ('left','temporary')) then raise exception using errcode='22023',message='仍有漏识别或不确定的成员，不能确认名单完整'; end if;
  elsif jsonb_array_length(p_absences)>0 then raise exception using errcode='22023',message='请重新准备缺席核对'; end if;
  -- A same-day revision retains earlier explicit departures unless that player reappears.
  if previous.id is not null and previous.deleted_at is null then
    select p_absences || coalesce(jsonb_agg(jsonb_build_object('player_id',a.player_id,'decision',a.decision)||case when a.reason is null then '{}'::jsonb else jsonb_build_object('reason',a.reason) end),'[]'::jsonb) into p_absences
    from (select distinct on (source.player_id) source.* from (
      select saved_absence.club_id,saved_absence.snapshot_id,saved_absence.player_id,saved_absence.decision,saved_absence.reason,0 as priority from public.club_snapshot_absences saved_absence
      union all select resolution.club_id,resolution.snapshot_id,resolution.player_id,resolution.decision,resolution.reason,1 from public.club_absence_resolutions resolution
    ) source where source.club_id=p_club_id and source.snapshot_id=previous.id order by source.player_id,source.priority desc) a where a.club_id=p_club_id and a.snapshot_id=previous.id and a.decision in ('left','temporary')
      and not exists(select 1 from jsonb_array_elements(resolved) r where r->>'player_id'=a.player_id::text)
      and not exists(select 1 from jsonb_array_elements(p_absences) x where x->>'player_id'=a.player_id::text);
  end if;
  select coalesce(jsonb_agg(a order by a->>'player_id'),'[]'::jsonb) into p_absences from jsonb_array_elements(p_absences) a;
  select encode(sha256(convert_to(jsonb_build_object('complete',p_complete,'members',jsonb_agg(value order by value->>'player_id'),'absences',p_absences)::text,'UTF8')),'hex')
    into content_hash from jsonb_array_elements(resolved);
  if previous.deleted_at is null and previous.content_hash = content_hash then return jsonb_build_object('snapshot_id',previous.id,'revision',previous.revision,'unchanged',true,'replayed',false); end if;
  next_revision := coalesce(previous.revision,0)+1;
  insert into public.club_imports(id,club_id,submitted_by,raw_text,schema_version,request_id,request_hash)
    values(import_id,p_club_id,actor,p_raw,1,p_request_id,request_hash);
  if previous.id is not null then update public.club_snapshots set is_current=false where id=previous.id and club_id=p_club_id; end if;
  insert into public.club_snapshots(id,club_id,snapshot_date,revision,import_id,is_complete_roster,supersedes_id,content_hash)
    values(snapshot_id,p_club_id,p_date,next_revision,import_id,p_complete,previous.id,content_hash);
  insert into public.club_snapshot_players(club_id,snapshot_id,player_id,name,position,level,pathway,extraordinary_score,prosperity,weekly_activity,group_name,join_days,source_name)
    select p_club_id,snapshot_id,(x->>'player_id')::uuid,x->>'name',x->>'position',(x->>'level')::integer,x->>'pathway',
      (x->>'extraordinary_score')::bigint,(x->>'prosperity')::bigint,(x->>'weekly_activity')::bigint,x->>'group',(x->>'join_days')::integer,x->>'source_name'
    from jsonb_array_elements(resolved) x;
  insert into public.club_snapshot_absences(club_id,snapshot_id,player_id,decision,reason) select p_club_id,snapshot_id,(a->>'player_id')::uuid,a->>'decision',case when a->>'decision'='temporary' then btrim(a->>'reason') else null end from jsonb_array_elements(p_absences) a;
  if jsonb_array_length(submitted_absences)>0 then
    insert into public.club_audit_events(club_id,actor_id,action,target_id,details) values(p_club_id,actor,'absence_reviewed',snapshot_id,jsonb_build_object('date',p_date,'decisions',submitted_absences));
  end if;
  insert into public.club_audit_events(club_id,actor_id,action,target_id,details)
    values(p_club_id,actor,'import_committed',snapshot_id,jsonb_build_object('date',p_date,'revision',next_revision,'mode',p_mode,'is_complete_roster',p_complete,'confirmed_mappings',mappings));
  return jsonb_build_object('snapshot_id',snapshot_id,'revision',next_revision,'unchanged',false,'replayed',false);
end $$;

create table public.club_absence_resolutions (
 id uuid primary key default gen_random_uuid(), club_id uuid not null, snapshot_id uuid not null, player_id uuid not null,
 decision text not null check(decision in ('left','temporary')), reason text,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(club_id,snapshot_id) references public.club_snapshots(club_id,id),
 foreign key(club_id,player_id) references public.club_players(club_id,id),
 unique(club_id,snapshot_id,player_id),
 check ((decision='temporary' and reason is not null and length(btrim(reason)) between 1 and 500 and reason !~ '[[:cntrl:]]') or (decision='left' and reason is null))
);
alter table public.club_absence_resolutions enable row level security;
create policy club_read_member on public.club_absence_resolutions for select to authenticated using (club_id in (select club_id from public.club_memberships where user_id=(select auth.uid()) and status='active') and exists(select 1 from public.club_snapshots s where s.club_id=club_absence_resolutions.club_id and s.id=club_absence_resolutions.snapshot_id));
revoke all on public.club_absence_resolutions from public,anon,authenticated;
grant select on public.club_absence_resolutions to authenticated;
create index club_absence_resolution_player on public.club_absence_resolutions(club_id,player_id,snapshot_id);

create function club_private.resolve_absence(p_club uuid,p_snapshot uuid,p_player uuid,p_decision text,p_reason text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target public.club_snapshots%rowtype; prior jsonb; saved public.club_absence_resolutions%rowtype;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then raise exception using errcode='42501',message='请先登录已确认邮箱的账户'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club::text,0));
 perform 1 from public.club_memberships where club_id=p_club and user_id=actor and status='active' and role in ('owner','admin') for share;
 if not found then raise exception using errcode='42501',message='没有处理成员的权限'; end if;
 if p_decision is null or p_decision not in ('left','temporary') or (p_decision='temporary' and (p_reason is null or length(btrim(p_reason)) not between 1 and 500 or p_reason ~ '[[:cntrl:]]')) or (p_decision='left' and p_reason is not null) then raise exception using errcode='22023',message='请选择退会或暂离，暂离须填写理由'; end if;
 select * into target from public.club_snapshots where club_id=p_club and id=p_snapshot and is_current and deleted_at is null for update;
 if not found then raise exception using errcode='PT409',message='名单已更新，请重新载入后处理'; end if;
 select * into saved from public.club_absence_resolutions where club_id=p_club and snapshot_id=p_snapshot and player_id=p_player;
 if found then
  if saved.decision=p_decision and saved.reason is not distinct from (case when p_decision='temporary' then btrim(p_reason) else null end) then return jsonb_build_object('saved',true); end if;
  raise exception using errcode='PT409',message='此成员已处理，请重新载入名单';
 end if;
 select value into prior from jsonb_array_elements(public.club_roster_presence(p_club,p_snapshot)->'members') where value->>'player_id'=p_player::text;
 if prior is null or prior->>'presence'<>'unconfirmed' then raise exception using errcode='PT409',message='此成员已不在待确认名单，请重新载入'; end if;
 insert into public.club_absence_resolutions(club_id,snapshot_id,player_id,decision,reason) values(p_club,p_snapshot,p_player,p_decision,case when p_decision='temporary' then btrim(p_reason) else null end);
 insert into public.club_audit_events(club_id,actor_id,action,target_id,details) values(p_club,actor,'absence_resolved',p_player,jsonb_build_object('snapshot_id',p_snapshot,'decision',p_decision,'reason',p_reason));
 return jsonb_build_object('saved',true);
end $$;
revoke all on function club_private.resolve_absence(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function club_private.resolve_absence(uuid,uuid,uuid,text,text) to authenticated;
create function public.club_resolve_absence(p_club uuid,p_snapshot uuid,p_player uuid,p_decision text,p_reason text default null) returns jsonb
language sql security invoker set search_path='' as $$ select club_private.resolve_absence(p_club,p_snapshot,p_player,p_decision,p_reason); $$;
revoke all on function public.club_resolve_absence(uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.club_resolve_absence(uuid,uuid,uuid,text,text) to authenticated;

create or replace function public.club_roster_presence(p_club uuid,p_snapshot uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare target public.club_snapshots%rowtype; complete_date date; result jsonb; n integer;
begin
 select * into target from public.club_snapshots where club_id=p_club and id=p_snapshot and deleted_at is null;
 if not found then return null; end if;
 select count(*) into n from (select 1 from public.club_players where club_id=p_club limit 1000) q;
 if n>=1000 then raise exception using errcode='54000',message='历史玩家超过当前查询上限'; end if;
 select count(*) into n from public.club_snapshot_players where club_id=p_club and snapshot_id=p_snapshot;
 if n>200 then raise exception using errcode='54000',message='名单超过查询上限'; end if;
 select max(snapshot_date) into complete_date from public.club_snapshots where club_id=p_club and deleted_at is null and is_current and is_complete_roster and snapshot_date<target.snapshot_date;
 if target.is_complete_roster then complete_date:=target.snapshot_date; end if;
 with observed as (
   select (to_jsonb(r)-'club_id'-'snapshot_id'-'source_name') || jsonb_build_object('presence','present','data_date',target.snapshot_date) as data
   from public.club_snapshot_players r where r.club_id=p_club and r.snapshot_id=p_snapshot
 ), absent as (
   select (to_jsonb(last.r)-'club_id'-'snapshot_id'-'source_name') || jsonb_build_object('data_date',last.seen,
     'presence',case when departure.decision in ('left','temporary') or (departure.decision is null and complete_date>last.seen) then 'left' else 'unconfirmed' end,'absence_decision',departure.decision,'absence_reason',departure.reason) as data
   from public.club_players p
   cross join lateral (
     select r,s.snapshot_date as seen from public.club_snapshot_players r join public.club_snapshots s on s.club_id=r.club_id and s.id=r.snapshot_id
     where r.club_id=p_club and r.player_id=p.id and s.deleted_at is null and s.is_current and s.snapshot_date<target.snapshot_date order by s.snapshot_date desc limit 1
   ) last
   left join lateral (
     select a.decision,a.reason from (
       select a.club_id,a.snapshot_id,a.player_id,a.decision,a.reason,0 as priority from public.club_snapshot_absences a
       union all select a.club_id,a.snapshot_id,a.player_id,a.decision,a.reason,1 from public.club_absence_resolutions a
     ) a join public.club_snapshots s on s.club_id=a.club_id and s.id=a.snapshot_id
     where a.club_id=p_club and a.player_id=p.id and s.deleted_at is null and s.snapshot_date>last.seen
       and ((s.is_current and s.snapshot_date<target.snapshot_date) or s.id=p_snapshot)
     order by s.snapshot_date desc,a.priority desc limit 1
   ) departure on true
   where p.club_id=p_club and not exists(select 1 from public.club_snapshot_players r where r.club_id=p_club and r.snapshot_id=p_snapshot and r.player_id=p.id)
 ) select coalesce(jsonb_agg(data),'[]'::jsonb) into result from (select data from observed union all select data from absent) q;
 return jsonb_build_object('members',result,'snapshot_count',n);
end $$;
revoke all on function public.club_roster_presence(uuid,uuid) from public,anon;
grant execute on function public.club_roster_presence(uuid,uuid) to authenticated;


create or replace function public.club_absence_context(p_club uuid,p_date date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare baseline public.club_snapshots%rowtype; roster jsonb;
begin
 select * into baseline from public.club_snapshots where club_id=p_club and deleted_at is null and is_current and snapshot_date<=p_date order by snapshot_date desc limit 1;
 if baseline.id is null then return jsonb_build_object('absence_version',2,'snapshot',null,'members','[]'::jsonb); end if;
 roster:=public.club_roster_presence(p_club,baseline.id);
 return jsonb_build_object('absence_version',2,'snapshot',jsonb_build_object('id',baseline.id,'snapshot_date',baseline.snapshot_date),
   'members',coalesce((select jsonb_agg(jsonb_build_object('player_id',x->>'player_id','name',coalesce(p.display_name,x->>'name')))
     from jsonb_array_elements(roster->'members') x join public.club_players p on p.club_id=p_club and p.id=(x->>'player_id')::uuid
     where x->>'presence'<>'left'),'[]'::jsonb));
end $$;
revoke all on function public.club_absence_context(uuid,date) from public,anon;
grant execute on function public.club_absence_context(uuid,date) to authenticated;


-- One player's effective absence, scoped to the requested historical revision.
create function public.club_player_absence(p_club uuid,p_snapshot uuid,p_player uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with target as (select * from public.club_snapshots where club_id=p_club and id=p_snapshot and deleted_at is null),
 seen as (select max(s.snapshot_date) as day from public.club_snapshot_players r join public.club_snapshots s on s.club_id=r.club_id and s.id=r.snapshot_id cross join target t where r.club_id=p_club and r.player_id=p_player and s.deleted_at is null and ((s.is_current and s.snapshot_date<t.snapshot_date) or s.id=t.id)),
 latest as (
 select a.decision,a.reason from (
 select club_id,snapshot_id,player_id,decision,reason,0 as priority from public.club_snapshot_absences
 union all select club_id,snapshot_id,player_id,decision,reason,1 from public.club_absence_resolutions
 ) a join public.club_snapshots s on s.club_id=a.club_id and s.id=a.snapshot_id cross join target t cross join seen
 where a.club_id=p_club and a.player_id=p_player and s.deleted_at is null and s.snapshot_date>seen.day and ((s.is_current and s.snapshot_date<t.snapshot_date) or s.id=t.id)
 order by s.snapshot_date desc,a.priority desc limit 1)
 select jsonb_build_object('absence_decision',latest.decision,'absence_reason',latest.reason) from (select 1) seed left join latest on true;
$$;
revoke all on function public.club_player_absence(uuid,uuid,uuid) from public,anon;
grant execute on function public.club_player_absence(uuid,uuid,uuid) to authenticated;

create or replace function public.club_history_page(p_club uuid,p_player uuid,p_date date default null,p_before date default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare identity jsonb; days jsonb; first_date date; previous_row jsonb; previous_date date; complete_date date; more boolean; departure_date date;
begin
  select jsonb_build_object('id',id,'display_name',display_name) into identity
    from public.club_players where club_id=p_club and id=p_player;
  if identity is null then return null; end if;
  with page as materialized (
    select id,snapshot_date,revision,is_complete_roster from public.club_snapshots
    where club_id=p_club and is_current and (p_date is null or snapshot_date<=p_date)
      and (p_before is null or snapshot_date<p_before)
    order by snapshot_date desc limit 100
  ) select min(s.snapshot_date),coalesce(jsonb_agg(jsonb_build_object(
    'snapshot_date',s.snapshot_date,'revision',s.revision,'is_complete_roster',s.is_complete_roster,'confirmed_left',exists(select 1 from public.club_snapshot_absences a where a.club_id=p_club and a.snapshot_id=s.id and a.player_id=p_player and a.decision='left'),
    'absence_decision',public.club_player_absence(p_club,s.id,p_player)->>'absence_decision','absence_reason',public.club_player_absence(p_club,s.id,p_player)->>'absence_reason',
    'rows',case when r.player_id is null then '[]'::jsonb else jsonb_build_array(to_jsonb(r)-'club_id'-'snapshot_id') end
  ) order by s.snapshot_date),'[]'::jsonb) into first_date,days
  from page s left join public.club_snapshot_players r on r.club_id=p_club and r.snapshot_id=s.id and r.player_id=p_player;
  select to_jsonb(r)-'club_id'-'snapshot_id',s.snapshot_date into previous_row,previous_date
    from public.club_snapshots s join public.club_snapshot_players r on r.club_id=s.club_id and r.snapshot_id=s.id and r.player_id=p_player
    where s.club_id=p_club and s.is_current and s.snapshot_date<first_date order by s.snapshot_date desc limit 1;
  select snapshot_date into complete_date from public.club_snapshots
    where club_id=p_club and is_current and is_complete_roster and snapshot_date<first_date order by snapshot_date desc limit 1;
  select max(s.snapshot_date) into departure_date from public.club_snapshot_absences a join public.club_snapshots s on s.club_id=a.club_id and s.id=a.snapshot_id where a.club_id=p_club and a.player_id=p_player and a.decision='left' and s.is_current and s.snapshot_date<first_date;
  select exists(select 1 from public.club_snapshots where club_id=p_club and is_current and snapshot_date<first_date) into more;
  return jsonb_build_object('player',identity,'days',days,'previous',previous_row,
    'absence',public.club_player_absence(p_club,(select id from public.club_snapshots where club_id=p_club and is_current and deleted_at is null and snapshot_date<first_date order by snapshot_date desc limit 1),p_player),
    'status',case when previous_row is null then null when greatest(complete_date,departure_date)>previous_date then 'left' else 'present' end,
    'next',case when more then first_date else null end);
end $$;
revoke all on function public.club_history_page(uuid,uuid,date,date) from public,anon;
grant execute on function public.club_history_page(uuid,uuid,date,date) to authenticated;
