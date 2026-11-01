import {test,expect} from '@playwright/test';
import {state,localFetch,baseURL} from './local.mjs';
// Real local Auth + Mailpit + the dashboard templates: a link is spent only by the person's click, then sets a password.
const mailpit='http://127.0.0.1:56324';
async function latestLink(email,subject){
 for(let i=0;i<40;i++){
  const list=await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
  const hit=list.messages?.find(m=>m.Subject===subject);
  if(hit){const html=(await (await fetch(`${mailpit}/api/v1/message/${hit.ID}`)).json()).HTML;await fetch(`${mailpit}/api/v1/messages`,{method:'DELETE',body:JSON.stringify({IDs:[hit.ID]})});return new URL(html.match(/href="([^"]+)"/)[1].replaceAll('&amp;','&'));}
  await new Promise(r=>setTimeout(r,250));
 }
 throw Error(`No mail "${subject}" for ${email}`);
}
const login=async(email,password)=>(await localFetch('/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:state().anonKey,'Content-Type':'application/json'},body:JSON.stringify({email,password})})).status;
test('invite and password reset links activate an account without being consumed by a GET',async({page,context})=>{
 await context.route('**/*',route=>new URL(route.request().url()).origin===baseURL?route.continue():route.abort());
 const email=`invited-${Date.now()}@club.test`,first='Invited-Local-2026!',second='Reset-Local-2026!x';
 const key=state().serviceKey;
 expect((await localFetch('/auth/v1/invite',{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({email})})).ok).toBe(true);
 const invite=await latestLink(email,'【俱乐部数据检测平台】邀请你加入俱乐部');
 // Manual dashboard invites carry the production callback; locally only the origin differs.
 expect(invite.origin+invite.pathname).toBe('https://club.squirrelapi.org/auth/confirm');expect(invite.searchParams.get('type')).toBe('invite');
 const local=`${baseURL}${invite.pathname}${invite.search}`;
 await page.goto(local);await page.goto(local); // a mail scanner's prefetch must not spend the token
 await page.getByRole('button',{name:'继续',exact:true}).click();await expect(page).toHaveURL(/\/auth\/set-password$/);
 await page.getByLabel('新密码',{exact:true}).fill(first);await page.getByLabel('再次输入',{exact:true}).fill(first);await page.getByRole('button',{name:'保存密码',exact:true}).click();
 await expect(page).not.toHaveURL(/set-password/);expect(await login(email,first)).toBe(200);
 await page.goto(local);await page.getByRole('button',{name:'继续',exact:true}).click();await expect(page.getByText('链接已失效或已被使用，请重新申请')).toBeVisible();
 await context.clearCookies();
 await page.goto('/login');await expect(page.getByRole('link',{name:'忘记密码？'})).toHaveAttribute('href','/auth/forgot');await page.goto('/auth/forgot');
 await page.getByLabel('邮箱',{exact:true}).fill(email);await page.getByRole('button',{name:'发送重置邮件',exact:true}).click();await expect(page.getByText(/如果该邮箱已注册/)).toBeVisible();
 const reset=await latestLink(email,'【俱乐部数据检测平台】重置登录密码');
 expect(reset.origin+reset.pathname).toBe(`${baseURL}/auth/confirm`);expect(reset.searchParams.get('type')).toBe('recovery');
 await page.goto(reset.href);await page.getByRole('button',{name:'继续',exact:true}).click();await expect(page).toHaveURL(/\/auth\/set-password$/);
 await page.getByLabel('新密码',{exact:true}).fill(second);await page.getByLabel('再次输入',{exact:true}).fill(second);await page.getByRole('button',{name:'保存密码',exact:true}).click();
 await expect(page).not.toHaveURL(/set-password/);expect(await login(email,second)).toBe(200);expect(await login(email,first)).toBe(400);
 // Unknown addresses get the same answer, so the form cannot discover accounts.
 const unknown=await context.request.post(`${baseURL}/api/auth/recover`,{headers:{Origin:baseURL},data:{email:'nobody@club.test'}});expect(await unknown.json()).toEqual({ok:true});
});
