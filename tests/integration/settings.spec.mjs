import {test,expect} from '@playwright/test';
import {auth,rest,audits,sql,clubId,foreignClubId,baseURL,users,password} from './local.mjs';
test('club name persists in PostgreSQL with owner-only rights and conflict protection',async({page,context,request})=>{
 await context.route('**/*',route=>new URL(route.request().url()).origin===baseURL?route.continue():route.abort());
 // Other specs may rename this club too; count only audit rows written during this test.
 const started=sql('select now();');
 await page.goto('/login');await page.getByLabel('邮箱',{exact:true}).fill(users.owner.email);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(/\/admin$/);await page.goto('/account'); // the Super Admin lands on the platform centre
 const before=await (await context.request.get(`${baseURL}/api/club-settings`)).json();
 await page.goto('/settings');await page.getByLabel('名称',{exact:true}).fill('白银之手');await page.getByRole('button',{name:'保存名称',exact:true}).click();await expect(page.getByRole('status')).toHaveText('名称已保存。');await expect(page.locator('.club-brand-name')).toHaveText('白银之手');
 const owner=(await auth('owner')).access_token;const stored=await (await rest(`club_clubs?id=eq.${clubId}&select=name`,owner)).json();expect(stored[0].name).toBe('白银之手');
 await page.reload();await expect(page.getByLabel('名称',{exact:true})).toHaveValue('白银之手');
 const conflict=await context.request.post(`${baseURL}/api/club-settings`,{headers:{Origin:baseURL},data:{name:'旧窗口修改',expected_name:before.name}});expect(conflict.status()).toBe(409);
 const empty=await context.request.post(`${baseURL}/api/club-settings`,{headers:{Origin:baseURL},data:{name:' ',expected_name:'白银之手'}});expect(empty.status()).toBe(400);
 for(const role of ['admin','outsider','foreign']){const token=(await auth(role)).access_token;const denied=await request.post(`${baseURL}/api/club-settings`,{headers:{Origin:baseURL,Cookie:`__Host-club_access=${token}`},data:{name:'越权改名',expected_name:'白银之手'}});expect(denied.status()).toBe(403);}
 expect((await rest('rpc/club_rename',owner,{p_club_id:foreignClubId,p_name:'跨俱乐部',p_expected:'Integration club B'})).status).toBe(403);
 expect((await rest(`club_clubs?id=eq.${clubId}`,owner,{name:'绕过接口'},'PATCH')).status).toBe(403);
 const renamed=audits(`club_id='${clubId}' and action='club_renamed' and created_at>='${started}'`);expect(renamed).toHaveLength(1);expect(renamed[0].details.new_name).toBe('白银之手');
});
