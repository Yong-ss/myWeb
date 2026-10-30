-- P2: every authorization decision goes through the P1 registry (can/require/readable_clubs).
-- Write functions below are their latest definitions with only the hard-coded owner/admin check replaced by
-- club_private.require(); tests/migration-auth-switch.test.mjs enforces that nothing else changed.
-- Super Admin powers stay gated by aal2 (TOTP) inside can(); without MFA the account keeps its ordinary memberships.

-- Several roles per user and club. Club roles are still checked by trigger and by can(); clients have no write grants.
alter table public.club_memberships drop constraint club_memberships_role_check;
alter table public.club_memberships drop constraint club_memberships_pkey, add primary key (club_id, user_id, role);

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
  perform club_private.require(p_club_id, 'imports.create');
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

create or replace function club_private.manage_alias(p_club_id uuid,p_player_id uuid,p_alias text,p_revoke_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target uuid; target_player uuid;
begin
  if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then raise exception using errcode='42501',message='请先登录已确认邮箱的账户'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club_id::text,0));
  perform club_private.require(p_club_id, 'aliases.manage');
  if p_revoke_id is not null then
    update public.club_player_aliases set revoked_at=now() where club_id=p_club_id and id=p_revoke_id and revoked_at is null returning id,player_id into target,target_player;
    if target is null then raise exception using errcode='22023',message='别名不存在或已解除'; end if;
  else
    if p_alias is null or length(btrim(p_alias)) not between 1 and 200 then raise exception using errcode='22023',message='别名无效'; end if;
    perform 1 from public.club_players where club_id=p_club_id and id=p_player_id for share;
    if not found then raise exception using errcode='42501',message='玩家不属于当前俱乐部'; end if;
    insert into public.club_player_aliases(club_id,player_id,alias_name,confirmed_by) values(p_club_id,p_player_id,btrim(p_alias),actor)
      on conflict (club_id,player_id,alias_name) where revoked_at is null do nothing returning id into target;
    if target is null then return jsonb_build_object('unchanged',true); end if;
    target_player:=p_player_id;
  end if;
  insert into public.club_audit_events(club_id,actor_id,action,target_id,details) values(p_club_id,actor,case when p_revoke_id is null then 'alias_confirmed' else 'alias_revoked' end,target,jsonb_build_object('player_id',target_player));
  return jsonb_build_object('id',target);
end $$;

create or replace function club_private.delete_import_date(p_club_id uuid,p_date date,p_expected uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); current_id uuid; n integer;
begin
  if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then
    raise exception using errcode='42501',message='请先登录已确认邮箱的账户';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club_id::text,0));
  perform club_private.require(p_club_id, 'imports.delete');
  if p_date is null or p_expected is null then raise exception using errcode='22023',message='请确认日期'; end if;
  select id into current_id from public.club_snapshots where club_id=p_club_id and snapshot_date=p_date and is_current for update;
  if current_id is distinct from p_expected then raise exception using errcode='PT409',message='当天数据已变化，请刷新后重新确认'; end if;
  update public.club_snapshots set deleted_at=now() where club_id=p_club_id and snapshot_date=p_date and deleted_at is null;
  get diagnostics n=row_count;
  if n>0 then
    insert into public.club_audit_events(club_id,actor_id,action,target_id,details) values
      (p_club_id,actor,'import_date_deleted',current_id,jsonb_build_object('date',p_date,'versions',n));
  end if;
  return jsonb_build_object('deleted',true,'date',p_date);
end $$;

create or replace function club_private.resolve_absence(p_club uuid,p_snapshot uuid,p_player uuid,p_decision text,p_reason text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target public.club_snapshots%rowtype; prior jsonb; saved public.club_absence_resolutions%rowtype;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then raise exception using errcode='42501',message='请先登录已确认邮箱的账户'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club::text,0));
 perform club_private.require(p_club, 'absences.resolve');
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

create or replace function public.club_rename(p_club_id uuid, p_name text, p_expected text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); previous_name text; next_name text := btrim(p_name);
begin
  if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then
    raise exception using errcode='42501', message='请先登录已确认邮箱的账户';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club_id::text,0));
  perform club_private.require(p_club_id, 'club.rename');
  if next_name is null or length(next_name) not between 1 and 120 or next_name ~ '[[:cntrl:]]' then
    raise exception using errcode='22023', message='名称需要 1～120 个字符，不能包含控制字符';
  end if;
  select name into previous_name from public.club_clubs where id=p_club_id for update;
  if not found then raise exception using errcode='42501', message='无权修改此俱乐部'; end if;
  if previous_name is distinct from p_expected then raise exception using errcode='PT409', message='名称已被修改，请刷新后重试'; end if;
  if previous_name is distinct from next_name then
    update public.club_clubs set name=next_name where id=p_club_id;
    insert into public.club_audit_events(club_id,actor_id,action,target_id,details)
      values(p_club_id,actor,'club_renamed',p_club_id,jsonb_build_object('old_name',previous_name,'new_name',next_name));
  end if;
  return jsonb_build_object('name',next_name);
end $$;

-- Business reads follow the registry: the same can() decides RLS, writes and the Worker.
-- readable_clubs() runs once per statement (InitPlan), not per row.
drop policy club_read_member on public.club_clubs;
create policy club_read_member on public.club_clubs for select to authenticated
  using (id in (select club_private.readable_clubs('members.read')));
do $$
declare t text;
begin
  foreach t in array array['club_players','club_imports','club_snapshots','club_snapshot_players','club_player_aliases'] loop
    execute format('drop policy club_read_member on public.%I', t);
    execute format('create policy club_read_member on public.%I for select to authenticated using (club_id in (select club_private.readable_clubs(%L)))', t, 'members.read');
  end loop;
end $$;
-- Clients have no SELECT on audit rows (club_activity is the reader); the policy still follows the registry.
drop policy club_read_member on public.club_audit_events;
create policy club_read_member on public.club_audit_events for select to authenticated
  using (club_id in (select club_private.readable_clubs('audit.read')));
drop policy club_read_member on public.club_snapshot_absences;
create policy club_read_member on public.club_snapshot_absences for select to authenticated using (
  club_id in (select club_private.readable_clubs('members.read'))
  and exists(select 1 from public.club_snapshots s where s.club_id = club_snapshot_absences.club_id and s.id = club_snapshot_absences.snapshot_id));
drop policy club_read_member on public.club_absence_resolutions;
create policy club_read_member on public.club_absence_resolutions for select to authenticated using (
  club_id in (select club_private.readable_clubs('members.read'))
  and exists(select 1 from public.club_snapshots s where s.club_id = club_absence_resolutions.club_id and s.id = club_absence_resolutions.snapshot_id));

-- First activation needs a second, out-of-band confirmation: a password thief could bind their own TOTP, so only
-- factors the owner confirms in Supabase SQL Editor (a separate Supabase login) unlock Super Admin powers.
-- No client role (nor service_role, i.e. the secret API key) can read or write this table or call the confirmation
-- function. Rows are the audit trail: which device, bound when, confirmed when and by which database role; they
-- are never updated or deleted (a removed factor simply stops matching).
create table public.platform_super_admin_factors (
  factor_id uuid primary key,
  -- No foreign key: removing a Super Admin must stay possible, and super_admin_active() rejoins the current list.
  user_id uuid not null,
  factor_name text,
  factor_created_at timestamptz,
  trusted_at timestamptz not null default now(),
  trusted_by text not null default session_user
);
alter table public.platform_super_admin_factors enable row level security;
revoke all on table public.platform_super_admin_factors from public, anon, authenticated, service_role;
create trigger platform_super_admin_factors_immutable before update or delete on public.platform_super_admin_factors for each row execute function club_private.audit_immutable();
create trigger platform_super_admin_factors_no_truncate before truncate on public.platform_super_admin_factors for each statement execute function club_private.audit_immutable();

-- Run in SQL Editor: select club_private.trust_super_admin_factor('<factor id shown in Club 设置>');
-- Invoker on purpose: even if EXECUTE were granted by mistake, clients lack the table privileges.
create function club_private.trust_super_admin_factor(p_factor uuid) returns text language plpgsql set search_path = '' as $$
declare f record;
begin
  select m.id, m.user_id, m.friendly_name, m.created_at into f from auth.mfa_factors m
    join public.platform_super_admins s on s.user_id = m.user_id
    where m.id = p_factor and m.status = 'verified' and m.factor_type = 'totp';
  if not found then raise exception using errcode = '22023', message = '只能确认超级管理员已完成验证的 TOTP 验证器'; end if;
  insert into public.platform_super_admin_factors(factor_id, user_id, factor_name, factor_created_at)
    values (f.id, f.user_id, f.friendly_name, f.created_at) on conflict (factor_id) do nothing;
  return format('已确认验证器：%s（绑定于 %s）', coalesce(f.friendly_name, f.id::text), f.created_at);
end $$;
revoke all on function club_private.trust_super_admin_factor(uuid) from public, anon, authenticated, service_role;

-- Powers need all of: aal2 JWT, a live aal2 Auth session of this user verified with a confirmed, still-verified TOTP.
-- Logging out or deleting the factor ends them at once, even before the JWT expires.
-- PL/pgSQL so ordinary (aal1) requests return before touching the Auth tables; RLS calls this once per club per statement.
create or replace function club_private.super_admin_active() returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt()->>'aal'), '') <> 'aal2' then return false; end if;
  return exists(select 1 from public.platform_super_admins s
      join auth.users u on u.id = s.user_id and u.email_confirmed_at is not null
      join auth.sessions ses on ses.id = (select case when auth.jwt()->>'session_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (auth.jwt()->>'session_id')::uuid end)
        and ses.user_id = s.user_id and ses.aal = 'aal2' and (ses.not_after is null or ses.not_after > now())
      join public.platform_super_admin_factors t on t.user_id = s.user_id and t.factor_id = ses.factor_id
      join auth.mfa_factors f on f.id = t.factor_id and f.user_id = s.user_id and f.status = 'verified' and f.factor_type = 'totp'
      where s.user_id = (select auth.uid()));
end $$;
revoke all on function club_private.super_admin_active() from public, anon, authenticated;

-- The Worker's single per-request read: the caller's own permissions, roles and Super Admin state for one club.
-- `super_admin` (listed) lets that account sign in to finish MFA; powers still require super_admin_active() via can().
create function public.club_my_access(p_club uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'permissions', to_jsonb(public.club_my_permissions(p_club)),
    'roles', coalesce((select jsonb_agg(m.role order by m.role) from public.club_memberships m
      join public.auth_roles r on r.key = m.role and r.scope_kind = 'club' and (r.club_id is null or r.club_id = m.club_id)
      join auth.users u on u.id = m.user_id and u.email_confirmed_at is not null
      where m.club_id = p_club and m.user_id = (select auth.uid()) and m.status = 'active'), '[]'::jsonb),
    'super_admin', exists(select 1 from public.platform_super_admins s join auth.users u on u.id = s.user_id
      where s.user_id = (select auth.uid()) and u.email_confirmed_at is not null),
    'super_admin_active', club_private.super_admin_active(),
    'session_aal2', coalesce((select auth.jwt()->>'aal'), '') = 'aal2');
$$;
revoke all on function public.club_my_access(uuid) from public, anon;
grant execute on function public.club_my_access(uuid) to authenticated;

-- The caller's own confirmed factor IDs, so Club 设置 can show which authenticators still need confirmation.
create function public.club_my_trusted_factors() returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(factor_id order by factor_id), '{}') from public.platform_super_admin_factors where user_id = (select auth.uid());
$$;
revoke all on function public.club_my_trusted_factors() from public, anon;
grant execute on function public.club_my_trusted_factors() to authenticated;
