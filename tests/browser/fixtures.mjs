import { expect } from '@playwright/test';
export const id = '00000000-0000-4000-8000-000000000001';
export const member = {name:'冷丶月',position:null,level:71,pathway:null,extraordinary_score:120,prosperity:null,weekly_activity:0,group:null,join_days:null};
// Deliberately incorrect AI metadata must not replace the operator's choices.
export const source = JSON.stringify({schema_version:1,snapshot_date:'2026-01-01',is_complete_roster:true,members:[member]});

export async function mockApp(page) {
  const state = { signedIn:false, submissions:[], failNext:false, conflict:false };
  await page.context().route('**/*',async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:8791') return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const respond=(status,body)=>route.fulfill({status,json:body,headers:{'Cache-Control':'no-store'}});
    if (url.pathname === '/api/login') {
      const input=route.request().postDataJSON();
      if (input.email !== 'fixture@example.invalid' || input.password !== 'local-test-only') return respond(401,{error:'邮箱、密码不正确'});
      state.signedIn=true; return respond(200,{ok:true});
    }
    if (!state.signedIn) return respond(401,{error:'请先登录'});
    if (url.pathname === '/api/account') return respond(200,{email:'fixture@example.invalid',role:'owner',club_id:id});
    if (url.pathname === '/api/logout') { state.signedIn=false; return respond(200,{ok:true}); }
    if (url.pathname === '/api/import-context') return respond(200,{players:[{id,display_name:'冷月',match_name:'冷月'}],snapshot:{id,revision:2,is_complete_roster:false},members:[{...member,name:'冷月',player_id:id}]});
    if (url.pathname === '/api/imports') {
      state.submissions.push(route.request().postDataJSON());
      if (state.conflict) return respond(409,{error:'同日数据已变化，请重新载入并确认预览'});
      if (state.failNext) { state.failNext=false; return respond(502,{error:'连接失败，请重试同一次提交'}); }
      return respond(200,{revision:3,unchanged:false,replayed:false});
    }
    return respond(404,{error:'Unknown test endpoint'});
  });
  return state;
}
export async function open(page,path) { await page.goto(path); await page.waitForLoadState('networkidle'); }
export async function login(page) {
  await open(page,'/login');
  await page.getByLabel('邮箱',{exact:true}).fill('fixture@example.invalid');
  await page.getByLabel('密码',{exact:true}).fill('local-test-only');
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect(page.getByText('你的身份：公会长',{exact:false})).toBeVisible();
}
export async function prepare(page,upload=false) {
  await open(page,'/import');
  await page.getByLabel('实际截图日期（可补录）',{exact:true}).fill('2026-10-27');
  if (upload) await page.getByLabel('上传 .json（最大 128 KiB）',{exact:true}).setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(source)});
  else await page.getByLabel('JSON 原文',{exact:true}).fill(source);
  await page.getByRole('button',{name:'校验并准备预览',exact:true}).click();
  await expect(page.getByRole('heading',{name:'2026-10-27 · 核对 1 条记录'})).toBeVisible();
}
export async function preview(page) {
  await page.getByLabel('第 1 行玩家身份',{exact:true}).selectOption(id);
  await page.getByLabel('同日处理方式（必须选择）',{exact:true}).selectOption('merge');
  await page.getByRole('button',{name:'生成最终预览',exact:true}).click();
  await expect(page.getByRole('heading',{name:'最终预览 · 1 人'})).toBeVisible();
}
