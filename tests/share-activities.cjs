// Run with Playwright installed: node tests/share-activities.cjs [demo URL]
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.argv[2] || pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    await page.locator('[data-mode="admin"]').click();
    await page.locator('[data-admin="review"]').click();
    const list = page.locator('#shareActivityList');
    const rows = page.locator('#shareActivityRows tr[data-share-activity]');
    assert.equal(await rows.count(), 7);
    assert.equal(await page.locator('#shareActivityReview').isVisible(), false);
    assert.equal(await list.locator('.share-heading>div').evaluate(el => getComputedStyle(el).display), 'block');
    assert.equal(await list.locator('th').allTextContents().then(x => x.join('|')), '活动名称|内容来源|活动链接|分享渠道|活动周期|更新时间|状态|操作');
    await page.screenshot({ path: path.join(os.tmpdir(), 'trumpf-share-activities.png'), fullPage: true });
    const firstId = await rows.first().getAttribute('data-share-activity');
    const firstName = await rows.first().locator('strong').innerText();
    const secondId = await rows.nth(1).getAttribute('data-share-activity');

    await page.locator('#shareActivitySearch').fill('trulaser');
    await page.locator('#shareActivitySearchForm button[type="submit"]').click();
    assert.equal(await rows.count(), 1);
    await page.locator('#shareActivitySearch').fill('不存在的活动');
    assert.equal(await rows.count(), 0);
    assert.match(await page.locator('#shareActivityRows').innerText(), /未找到/);
    await page.locator('#shareActivityReset').click();
    assert.equal(await rows.count(), 7);

    await list.getByRole('button', {name:'新建活动', exact:true}).click();
    assert.deepEqual(await page.locator('#shareActivitySource option').allTextContents(), ['服务号','公众号']);
    assert.equal(await page.locator('#shareActivityChannel').getAttribute('type'), null);
    const save = page.locator('#shareActivityForm button[type="submit"]');
    const expectError = async text => { await save.click(); assert.match(await page.locator('#shareActivityError').innerText(), text); assert.ok(await page.locator('#shareActivityEditor').isVisible()); };
    await expectError(/请填写活动名称/);
    await page.locator('#shareActivityName').fill('   ');
    await expectError(/请填写活动名称/);
    const unsafeName = '<img src=x onerror="window.activityXss=1"> 测试活动';
    await page.locator('#shareActivityName').fill(unsafeName);
    await expectError(/请填写活动链接/);
    await page.locator('#shareActivityLink').fill('javascript:alert(1)');
    await expectError(/有效的活动链接/);
    await page.locator('#shareActivityLink').fill('https://example.com/activity?a=1&b=2');
    await expectError(/请填写分享渠道/);
    await page.locator('#shareActivityChannel').fill('微信朋友圈、企业微信群');
    await expectError(/开始日期/);
    await page.locator('#shareActivityStart').fill('2026-11-13');
    await expectError(/结束日期/);
    await page.locator('#shareActivityEnd').fill('2026-11-12');
    await expectError(/不能早于/);
    await page.locator('#shareActivityEnd').fill('2026-11-13');
    await page.locator('#shareActivitySource').selectOption('公众号');
    await page.locator('[name="shareActivityStatus"][value="off"]').check();
    assert.equal(await page.locator('#shareActivityError').isVisible(), false);
    await page.screenshot({path:path.join(os.tmpdir(),'trumpf-share-activity-editor.png'),fullPage:true});
    await save.click();
    assert.ok(await list.isVisible());
    assert.equal(await rows.count(), 8);
    const createdId = await rows.first().getAttribute('data-share-activity');
    const created = page.locator(`[data-share-activity="${createdId}"]`);
    assert.match(await created.innerText(), /关闭/);
    assert.equal(await created.locator('strong').innerText(), unsafeName);
    assert.equal(await created.locator('img').count(), 0);
    assert.equal(await page.evaluate(() => window.activityXss), undefined);

    await created.getByRole('button',{name:'详情',exact:true}).click();
    assert.match(await page.locator('#shareActivityDetailFields').innerText(), /微信朋友圈、企业微信群/);
    assert.equal(await page.locator('#shareActivityDetailFields input').count(), 0);
    assert.equal(await page.locator('#shareActivityDetailFields a').getAttribute('href'), 'https://example.com/activity?a=1&b=2');
    await page.locator('#shareActivityDetailEdit').click();
    assert.equal(await page.locator('#shareActivityName').inputValue(), unsafeName);
    await page.locator('#shareActivityName').fill('取消的草稿');
    await page.locator('#shareActivityForm').getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(await created.locator('strong').innerText(), unsafeName);
    await created.getByRole('button',{name:'编辑',exact:true}).click();
    await page.locator('#shareActivityName').fill(firstName); // Duplicate names must not merge activities or proofs.
    await page.locator('[name="shareActivityStatus"][value="on"]').check();
    await save.click();
    assert.equal(await rows.count(), 8);
    assert.match(await created.innerText(), /开启/);
    assert.equal(await created.locator('strong').innerText(), firstName);
    assert.match(await created.locator('td').nth(5).innerText(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    await created.getByRole('button',{name:'审核',exact:true}).click();
    assert.match(await page.locator('#reviewRowsV2').innerText(), /暂无分享凭证/);
    assert.ok(await page.locator('#shareReviewSelectAll').isDisabled());
    await page.locator('#shareActivityReview').getByRole('button',{name:'批量通过',exact:true}).click();
    assert.match(await page.locator('#toast').innerText(), /请先选择/);
    await page.locator('#shareActivityReview .share-back').click();

    const original = page.locator(`[data-share-activity="${firstId}"]`);
    await original.getByRole('button',{name:'审核',exact:true}).click();
    assert.equal(await page.locator('#reviewRowsV2 tr').count(), 1);
    assert.match(await page.locator('#shareActivityReviewName').innerText(), /TruLaser/);
    assert.equal(await page.locator('#reviewRowsV2 td').count(), 9);
    await page.locator('#reviewRowsV2 .proof-thumb').click();
    assert.ok(await page.locator('#imageOnly').isVisible());
    await page.evaluate(() => closeImageOnly());
    await page.locator('#reviewRowsV2').getByRole('button',{name:'查看详情',exact:true}).click();
    assert.ok(await page.locator('#reviewModalV2').isVisible());
    assert.match(await page.locator('#reviewDetailContentV2').innerText(), /王海峰/);
    assert.equal(await page.locator('#reviewDetailContentV2 .review-attachments button').count(), 3);
    await page.evaluate(() => closeReviewDetailV2());
    assert.equal(await page.evaluate(() => getActivityReviews()[0].s), 'pending');
    // A stale/cross-activity action must never mutate a different activity's records.
    assert.equal(await page.evaluate(secondId => {
      const other = reviews.find(item => item.activityId === secondId);
      reviewOneV2(other.id,'rejected'); openReviewDetailV2(other.id);
      return other.s;
    }, secondId), 'pending');
    assert.equal(await page.locator('#reviewModalV2').isVisible(), false);
    await page.locator('#reviewRowsV2').getByRole('button',{name:'通过',exact:true}).click();
    assert.equal(await page.evaluate(() => getActivityReviews()[0].s), 'approved');
    await page.locator('#shareActivityReview .share-back').click();
    await page.locator(`[data-share-activity="${secondId}"]`).getByRole('button',{name:'审核',exact:true}).click();
    await page.locator('#reviewRowsV2').getByRole('button',{name:'驳回',exact:true}).click();
    assert.equal(await page.evaluate(() => getActivityReviews()[0].s), 'rejected');

    // Exercise partial selection, select-all, status guards and real multi-record batches.
    await page.evaluate(firstId => {
      const seed = reviews.find(item => item.activityId === firstId);
      reviews.push({...seed,id:'TEST-A',s:'pending'},{...seed,id:'TEST-B',s:'pending'});
      openShareActivityReviews(firstId);
    }, firstId);
    await page.locator('[data-check-v2="TEST-A"]').check();
    assert.ok(await page.locator('#shareReviewSelectAll').evaluate(input => input.indeterminate));
    await page.locator('#shareActivityReview').getByRole('button',{name:'批量驳回',exact:true}).click();
    assert.deepEqual(await page.evaluate(() => reviews.filter(r => r.id.startsWith('TEST-')).map(r => r.s)), ['rejected','pending']);
    await page.locator('#shareReviewSelectAll').check();
    await page.locator('#shareActivityReview').getByRole('button',{name:'批量通过',exact:true}).click();
    assert.deepEqual(await page.evaluate(() => getActivityReviews().map(r => r.s)), ['approved','rejected','approved']);
    assert.ok(await page.locator('#shareReviewSelectAll').isDisabled());
    await page.screenshot({ path: path.join(os.tmpdir(),'trumpf-share-activity-review.png'),fullPage:true });
    await page.locator('[data-admin="review"]').click();
    assert.ok(await list.isVisible());

    for (const width of [1440, 390]) {
      await page.setViewportSize({width,height:1000});
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow,false,`Activity list overflow at ${width}px`);
      await list.getByRole('button',{name:'新建活动',exact:true}).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,`Editor overflow at ${width}px`);
      if (width === 390) await page.screenshot({path:path.join(os.tmpdir(),'trumpf-share-activity-mobile.png'),fullPage:true});
      await page.locator('#shareActivityForm').getByRole('button',{name:'取消',exact:true}).click();
    }
    assert.equal(await page.locator('#mobile .head strong').innerText(), '通快客户积分中心');
    assert.equal(await page.locator('#mobile .brand').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: activity CRUD/search/validation/text safety; activity-scoped detail/image/individual/batch review; desktop/mobile layout; no page errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
