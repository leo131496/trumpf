// node tests/content-sharing.cjs [demo URL]; PLAYWRIGHT_CHANNEL=chrome for installed Chrome.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');

(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(process.argv[2]||pathToFileURL(path.resolve(__dirname,'../index.html')).href);
    await page.evaluate(()=>login());
    await page.locator('[data-mode="phone"]').click();
    assert.match(await page.locator('[data-nav="tasks"]').innerText(),/内容分享/);
    assert.equal(await page.locator('#personalHome .grid').getByText('内容分享',{exact:true}).count(),1);
    await page.locator('[data-nav="tasks"]').click();
    assert.equal(await page.locator('[data-view="tasks"] h1').innerText(),'内容分享');
    assert.equal(await page.locator('[data-view="tasks"]').getByText(/新增凭证/).count(),0);
    const cards=page.locator('#taskArea [data-content-activity]');
    const card=id=>page.locator(`[data-content-activity="${id}"]`);
    assert.equal(await cards.count(),7);
    assert.deepEqual(new Set(await cards.evaluateAll(items=>items.map(item=>item.dataset.contentStatus))),new Set(['todo','pending','approved','rejected','expired']));
    assert.equal(await card('SHARE-003').getAttribute('data-content-status'),'todo','Another user’s submission must not change the current user’s state');
    for (const state of ['todo','pending','approved','rejected','expired']) {
      await page.locator(`[data-proof-filter="${state}"]`).click();
      assert.ok(await cards.count()>0);
      assert.ok((await cards.evaluateAll(items=>items.map(item=>item.dataset.contentStatus))).every(value=>value===state));
    }
    await page.locator('[data-proof-filter="all"]').click();
    await page.locator('#mobile').screenshot({path:path.join(os.tmpdir(),'trumpf-content-sharing.png')});
    await card('SHARE-001').getByRole('button',{name:'查看详情',exact:true}).click();
    assert.match(await page.locator('#sheetContent').innerText(),/视频号ID/);
    assert.match(await page.locator('#sheetContent').innerText(),/审核中/);
    await page.evaluate(()=>closeSheet());
    assert.equal(await card('SHARE-001').getAttribute('data-content-status'),'pending');
    for (const id of ['SHARE-001','SHARE-005','SHARE-007']) assert.ok(await card(id).getByRole('button',{name:'补全凭证',exact:true}).isDisabled());
    await page.evaluate(()=>completeActivityProof('SHARE-005'));
    assert.equal(await page.locator('[data-view="newProof"]').isVisible(),false);

    await card('SHARE-003').getByRole('button',{name:'补全凭证',exact:true}).click();
    assert.equal(await page.locator('#proofFormTitle').innerText(),'补全凭证');
    assert.equal(await page.locator('#proofTitle,#proofShareChannel,#proofContentSource').count(),0);
    await page.locator('#proofSubmitButton').click();
    assert.match(await page.locator('#proofUploadError').innerText(),/至少上传 1 张/);
    const input=page.locator('#proofImageInput');
    const upload=async files=>{await input.setInputFiles(files);await page.waitForFunction(()=>!proofUploadBusy)};
    await upload({name:'bad.txt',mimeType:'text/plain',buffer:Buffer.from('invalid')});
    assert.match(await page.locator('#proofUploadError').innerText(),/仅支持/);
    await upload({name:'bad.png',mimeType:'image/png',buffer:Buffer.from('invalid PNG')});
    assert.match(await page.locator('#proofUploadError').innerText(),/有效的/);
    const urls=await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=80;canvas.height=80;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#0066FF';ctx.fillRect(0,0,80,80);
      return ['image/jpeg','image/png','image/webp'].map(type=>canvas.toDataURL(type));
    });
    const files=urls.map((url,index)=>({name:['截图.jpg','截图.png','截图.webp'][index],mimeType:['image/jpeg','image/png','image/webp'][index],buffer:Buffer.from(url.split(',')[1],'base64')}));
    await upload(Array.from({length:10},(_,i)=>({...files[i%3],name:`截图${i}.png`})));
    assert.match(await page.locator('#proofUploadError').innerText(),/最多上传 9 张/);
    assert.equal(await page.locator('#proofImages img').count(),0);
    await upload(Array.from({length:9},(_,i)=>({...files[i%3],name:`截图${i}.png`})));
    assert.equal(await page.locator('#proofImages img').count(),9);
    assert.ok(await page.locator('#proofUploadButton').isDisabled());
    await page.locator('#proofImages .proof-image-remove').last().click();
    assert.ok(await page.locator('#proofUploadButton').isEnabled());
    while(await page.locator('#proofImages img').count()) await page.locator('#proofImages .proof-image-remove').last().click();
    await upload(files);
    await page.locator('#proofImages .proof-image-preview').first().click();
    await page.waitForFunction(()=>document.getElementById('imageOnlyContent').naturalWidth>0);
    await page.evaluate(()=>closeImageOnly());
    await page.locator('#mobile').screenshot({path:path.join(os.tmpdir(),'trumpf-content-complete.png')});
    await page.locator('#proofSubmitButton').click();
    assert.equal(await card('SHARE-003').getAttribute('data-content-status'),'pending');
    const own=await page.evaluate(()=>ownActivityProof('SHARE-003'));
    assert.equal(own.attachments.length,3);
    assert.equal(own.u,'钱辰');
    assert.equal(own.attachments[1].src,urls[1]);
    assert.equal(await page.evaluate(()=>reviews.filter(r=>r.activityId==='SHARE-003').length),2);
    await page.evaluate(()=>submitNewProof());
    assert.equal(await page.evaluate(()=>reviews.filter(r=>r.activityId==='SHARE-003').length),2);

    const reviewActivity=async id=>{
      await page.locator('[data-mode="admin"]').click();await page.locator('[data-admin="review"]').click();
      await page.locator(`[data-share-activity="${id}"]`).getByRole('button',{name:'审核',exact:true}).click();
    };
    const returnPhone=async()=>{await page.locator('[data-mode="phone"]').click();await page.evaluate(()=>showView('tasks'))};
    await reviewActivity('SHARE-003');
    const reviewRow=page.locator('#reviewRowsV2 tr').filter({has:page.locator(`[data-check-v2="${own.id}"]`)});
    await reviewRow.getByRole('button',{name:'查看详情',exact:true}).click();
    assert.equal(await page.locator('#reviewDetailContentV2 .review-attachments img').nth(1).getAttribute('src'),urls[1]);
    await page.locator('#reviewDetailActionsV2').getByRole('button',{name:'驳回',exact:true}).click();
    await returnPhone();
    assert.equal(await card('SHARE-003').getAttribute('data-content-status'),'rejected');
    assert.ok(await card('SHARE-003').getByRole('button',{name:'补全凭证',exact:true}).isEnabled());
    assert.match(await page.locator('#contentShareTodoHome').textContent(),/智能工厂/);
    await card('SHARE-003').getByRole('button',{name:'补全凭证',exact:true}).click();
    assert.equal(await page.locator('#proofImages img').count(),3);
    await page.locator('#proofImages .proof-image-remove').last().click();
    await page.locator('[data-view="newProof"] .subhead button').click();
    assert.equal(await page.evaluate(()=>ownActivityProof('SHARE-003').attachments.length),3,'Cancel must preserve the submitted images');
    await card('SHARE-003').getByRole('button',{name:'补全凭证',exact:true}).click();
    await page.locator('#proofImages .proof-image-remove').last().click();
    await upload([files[2]]);
    await page.locator('#proofSubmitButton').click();
    assert.equal(await page.evaluate(()=>ownActivityProof('SHARE-003').id),own.id);
    assert.doesNotMatch(await page.locator('#contentShareTodoHome').textContent(),/智能工厂/);
    await reviewActivity('SHARE-003');
    await page.locator(`[data-check-v2="${own.id}"]`).check();
    await page.locator('#shareActivityReview').getByRole('button',{name:'批量通过',exact:true}).click();
    await returnPhone();
    assert.equal(await card('SHARE-003').getAttribute('data-content-status'),'approved');
    assert.equal(await page.evaluate(()=>reviews.find(r=>r.activityId==='SHARE-003'&&r.userId!==contentShareUser.id).s),'pending');
    assert.equal(await page.evaluate(()=>contentShareState({...shareActivities.find(a=>a.id==='SHARE-003'),end:'2020-01-01'})),'approved');

    // Create through the real admin form and verify publication/closure/expiry guards.
    await page.locator('[data-mode="admin"]').click();await page.locator('[data-admin="review"]').click();
    await page.locator('#shareActivityList').getByRole('button',{name:'新建活动',exact:true}).click();
    await page.locator('#shareActivityName').fill('前后台联动新活动');
    await page.locator('#shareActivityVideoId').fill('sphLinkedDemo');
    await page.locator('#shareActivityChannel').fill('微信朋友圈、客户群');
    await page.locator('#shareActivityStart').fill('2026-01-01');
    await page.locator('#shareActivityEnd').fill('2099-12-31');
    await page.locator('#shareActivityEnabled').uncheck();
    await page.locator('#shareActivityForm button[type="submit"]').click();
    const created=await page.locator('#shareActivityRows tr').first().getAttribute('data-share-activity');
    assert.equal(await card(created).count(),0);
    await page.locator(`[data-share-activity="${created}"]`).getByRole('switch').check();
    await returnPhone();
    assert.match(await card(created).innerText(),/前后台联动新活动/);
    assert.equal(await card(created).getAttribute('data-content-status'),'todo');
    await card(created).getByRole('button',{name:'查看详情',exact:true}).click();
    assert.match(await page.locator('#sheetContent').innerText(),/sphLinkedDemo/);await page.evaluate(()=>closeSheet());
    await card(created).getByRole('button',{name:'补全凭证',exact:true}).click();await upload([files[1]]);
    await page.evaluate(id=>toggleShareActivity(id,false),created);
    await page.locator('#proofSubmitButton').click();
    assert.match(await page.locator('#proofUploadError').innerText(),/已关闭/);
    assert.equal(await page.evaluate(id=>Boolean(ownActivityProof(id)),created),false);
    await page.evaluate(id=>{toggleShareActivity(id,true);shareActivities.find(a=>a.id===id).end='2026-01-02'},created);
    await page.locator('#proofSubmitButton').click();
    assert.match(await page.locator('#proofUploadError').innerText(),/已过期/);
    await page.locator('[data-view="newProof"] .subhead button').click();
    assert.equal(await card(created).getAttribute('data-content-status'),'expired');

    for (const width of [320,390]) {
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await card('SHARE-004').getByRole('button',{name:'补全凭证',exact:true}).click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      if(width===390) await page.screenshot({path:path.join(os.tmpdir(),'trumpf-content-upload-mobile.png'),fullPage:true});
      await page.locator('[data-view="newProof"] .subhead button').click();
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: five activity states, filters, admin-to-customer publishing, real image validation/limits/preview, submit/reject/resubmit/approve sync, ownership, expiry/closure/repeat guards, mobile layout.');
  } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
