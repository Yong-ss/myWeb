import {test,expect} from '@playwright/test';
for(const [width,height] of [[1440,900],[768,1024],[390,844],[320,800]]) {
  test(`shared account components and navigation ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height});
    await page.route('**/api/**',route=>route.fulfill({json:{email:'archive-keeper@example.invalid',role:'owner'}}));
    await page.goto('/account');
    await expect(page.getByRole('heading',{name:'俱乐部总览',exact:true})).toBeVisible();
    await expect(page.getByText('archive-keeper@example.invalid')).toBeVisible();
    await expect(page.locator('.club-account-actions .club-panel')).toHaveCount(2);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.getByRole('link',{name:'查看名单'})).toHaveAttribute('href','/members');
    const start=page.getByRole('link',{name:'开始导入'});await start.focus();await expect(start).toHaveCSS('outline-style','solid');
    if(width<1024) {await page.getByRole('button',{name:'菜单'}).click();await expect(page.getByRole('dialog').locator('[aria-current="page"]')).toHaveText('◇俱乐部总览');await page.keyboard.press('Escape');}
    else await expect(page.locator('.club-sidebar [aria-current="page"]')).toHaveText('◇俱乐部总览');
    await page.screenshot({path:info.outputPath('account.png'),fullPage:true});
  });
}
test('shared logout button prevents duplicate requests and keeps error actionable',async({page})=>{
  let finish;let requests=0;
  await page.route('**/api/**',async route=>{
    if(new URL(route.request().url()).pathname==='/api/logout') {requests++;await new Promise(resolve=>finish=resolve);return route.fulfill({status:503,json:{error:'暂时无法退出，请重试'}});}
    return route.fulfill({json:{email:'archive-keeper@example.invalid',role:'owner'}});
  });
  await page.goto('/account');const button=page.getByRole('button',{name:'退出登录',exact:true});
  const before=await button.boundingBox();await button.click();
  const loading=page.getByRole('button',{name:'正在退出…',exact:true});await expect(loading).toBeDisabled();await expect(loading).toHaveAttribute('aria-busy','true');
  expect((await loading.boundingBox()).width).toBe(before.width);
  await expect.poll(()=>typeof finish).toBe('function');finish();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('暂时无法退出，请重试');await expect(button).toBeEnabled();expect(requests).toBe(1);
});
