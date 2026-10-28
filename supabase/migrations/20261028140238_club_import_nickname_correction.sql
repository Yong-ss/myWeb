create or replace function club_private.commit_import(
  p_club_id uuid, p_date date, p_complete boolean, p_mode text, p_rows jsonb,
  p_raw text, p_request_id uuid, p_expected uuid, p_confirmed boolean
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
  next_revision integer; old_name text; new_name text;
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
  request_hash := encode(sha256(convert_to(jsonb_build_object('date',p_date,'complete',p_complete,'mode',p_mode,'rows',p_rows,'raw',p_raw,'expected',p_expected)::text,'UTF8')),'hex');
  select i.request_hash, s.id, s.revision, s.deleted_at into replay from public.club_imports i join public.club_snapshots s on s.club_id=i.club_id and s.import_id=i.id where i.club_id=p_club_id and i.request_id=p_request_id;
  if found then
    if replay.deleted_at is not null then raise exception using errcode='PT409', message='此导入已删除，请重新准备数据'; end if;
    if replay.request_hash is distinct from request_hash then raise exception using errcode='22023', message='此提交编号已用于其他内容，请重新预览'; end if;
    return jsonb_build_object('snapshot_id',replay.id,'revision',replay.revision,'replayed',true,'unchanged',false);
  end if;
  select * into previous from public.club_snapshots where club_id=p_club_id and snapshot_date=p_date and is_current for update;
  if (case when previous.deleted_at is null then previous.id else null end) is distinct from p_expected then raise exception using errcode='PT409', message='同日数据已变化，请重新载入并确认预览'; end if;

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
  select encode(sha256(convert_to(jsonb_build_object('complete',p_complete,'members',jsonb_agg(value order by value->>'player_id'))::text,'UTF8')),'hex')
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
  insert into public.club_audit_events(club_id,actor_id,action,target_id,details)
    values(p_club_id,actor,'import_committed',snapshot_id,jsonb_build_object('date',p_date,'revision',next_revision,'mode',p_mode,'is_complete_roster',p_complete,'confirmed_mappings',mappings));
  return jsonb_build_object('snapshot_id',snapshot_id,'revision',next_revision,'unchanged',false,'replayed',false);
end $$;
