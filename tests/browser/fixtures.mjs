import { expect, test } from '@playwright/test';
export const id = '00000000-0000-4000-8000-000000000001';
export const member = {name:'冷丶月',position:null,level:71,pathway:null,extraordinary_score:120,prosperity:null,weekly_activity:0,group:null,join_days:null};
// Deliberately incorrect AI metadata must not replace the operator's choices.
export const source = JSON.stringify({schema_version:1,snapshot_date:'2026-01-01',is_complete_roster:true,members:[member]});

export async function mockApp(page) {
  const state = { signedIn:false, submissions:[], failNext:false, conflict:false };
  await page.context().route('**/*',async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(test.info().project.use.baseURL ?? 'http://127.0.0.1:8791').origin) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const respond=(status,body)=>route.fulfill({status,json:body,headers:{'Cache-Control':'no-store'}});
    if (url.pathname === '/api/login') {
      const input=route.request().postDataJSON();
      if (input.email !== 'fixture@example.invalid' || input.password !== 'local-test-only') return respond(401,{error:'邮箱、密码不正确'});
      state.signedIn=true; return respond(200,{ok:true});
    }
    if (!state.signedIn) return respond(401,{error:'请先登录'});
    if (url.pathname === '/api/account') return respond(200,{email:'fixture@example.invalid',roles:['owner'],permissions:['absences.resolve','aliases.manage','audit.read','club.rename','imports.create','imports.delete','members.read'],super_admin:false,mfa_verified:false,club_id:id,clubs:[{id,name:'测试俱乐部',roles:['owner']}]});
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
  await expect(page.getByText('公会长',{exact:true})).toBeVisible();
}
export async function prepare(page,upload=false) {
  await open(page,'/import');
  await page.getByLabel('截图日期',{exact:true}).fill('2026-10-27');
  if (upload) { await page.getByRole('tab',{name:'上传文件',exact:true}).click();await page.getByLabel('JSON 文件',{exact:true}).setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(source)}); }
  else await page.getByLabel('JSON 内容',{exact:true}).fill(source);
  await page.getByRole('button',{name:'下一步',exact:true}).click();
  await expect(page.getByRole('heading',{name:'核对成员',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
export async function preview(page) {
  if(await page.getByText('还有 1 人没对上',{exact:true}).isVisible()) {
    await page.locator('.identity-launcher').first().click();
    const dialog=page.getByRole('dialog',{name:'这是新玩家，还是已有玩家？'});
    await dialog.getByRole('button',{name:'选择已有玩家',exact:true}).click();
    await dialog.getByRole('button',{name:/^冷月/}).click();
    await dialog.getByRole('button',{name:'确认',exact:true}).click();
  }
  await page.getByRole('radio',{name:/^只补充／修正部分玩家/}).check();
  await page.getByRole('button',{name:'下一步 →',exact:true}).click();
  await expect(page.getByRole('heading',{name:'最终预览 · 1 人'})).toBeVisible();
}
