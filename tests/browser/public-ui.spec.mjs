import {test,expect} from '@playwright/test';
for(const [width,height] of [[1440,900],[390,844],[320,800]]) {
  test(`public home and login share components ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height});
    await page.route('**/api/**',route=>route.fulfill({status:401,json:{error:'测试账户未获授权'}}));
    await page.goto('/');await expect(page.locator('.club-app')).toHaveCSS('background-color','rgb(20, 23, 24)');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('home.png'),fullPage:true});
    await page.goto('/login');await expect(page.getByRole('heading',{name:'登录俱乐部',exact:true})).toBeVisible();await page.getByLabel('邮箱',{exact:true}).fill('test@example.invalid');await page.getByLabel('密码',{exact:true}).fill('wrong');await page.getByRole('button',{name:'登录',exact:true}).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('测试账户未获授权');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath('login.png'),fullPage:true});
  });
}
