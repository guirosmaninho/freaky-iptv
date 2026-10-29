const { test, expect, _electron: electron } = require('playwright/test');
const { closeTestApp } = require('./closeTestApp.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

let app, page, dataDir;
const sizes = [[1024, 600], [1440, 900], [1728, 1000]];
const settings = {playlistUrl:'',epgUrl:'',favoriteChannelIds:[],recentlyViewedChannelIds:[],autoplayLastChannel:false,autoRefreshHours:0,historyRetentionDays:3650,discordRpcEnabled:false,appearance:'light',language:'en',openedReviewIds:[],dismissedReviewIds:[]};

async function resizeNative(width, height) {
  const actual = await app.evaluate(({BrowserWindow},size)=>{const win=BrowserWindow.getAllWindows()[0];win.setContentSize(...size);return win.getContentSize();},[width,height]);
  // No page.setViewportSize: Chromium must follow the real desktop window.
  await expect.poll(()=>page.evaluate(()=>[innerWidth,innerHeight])).toEqual(actual);
  const shell=await page.locator('.app-shell').boundingBox();
  expect(Math.round(shell.width)).toBe(actual[0]);
  expect(Math.round(shell.height)).toBe(actual[1]);
}
async function contained(selectors) {
  const issues=await page.evaluate(selectors=>{
    const main=document.querySelector('.app-main-surface').getBoundingClientRect();
    return selectors.flatMap(selector=>Array.from(document.querySelectorAll(selector)).flatMap(el=>{
      const r=el.getBoundingClientRect();if(!r.width||!r.height)return [];
      return r.left<main.left-1||r.right>main.right+1?[`${selector}: ${Math.round(r.left)}..${Math.round(r.right)} outside ${Math.round(main.left)}..${Math.round(main.right)}`]:[];
    }));
  },selectors);
  expect(issues).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}

test.beforeEach(async()=>{
  dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'freaky-layout-'));
  app=await electron.launch({args:['.','--disable-gpu'],cwd:path.resolve(__dirname,'..'),env:{...process.env,FREAKYIPTV_E2E:'1',FREAKYIPTV_DATA_DIR:dataDir}});
  page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');
  await page.clock.install({time:new Date('2026-10-28T12:00:00Z')});
  await page.evaluate(s=>window.electron.saveSettings(s),settings);
  await page.reload();
});
test.afterEach(async()=>{await closeTestApp(app);if(dataDir)fs.rmSync(dataDir,{recursive:true,force:true});});

test('keeps first-run setup and an existing viewing review within the native window',async()=>{
  await page.evaluate(()=>window.electron.saveHistory([{
    sessionId:'layout-weekly',channelId:'layout-0',canonicalChannelId:'layout-0',channelName:'Sport TV 1 Full HD',baseChannelName:'Sport TV 1',channelGroup:'Sports',
    startTimeUtc:'2026-10-20T19:00:00Z',endTimeUtc:'2026-10-20T21:00:00Z',playingDurationMs:7200000,bytesConsumed:1048576,bytesSource:'network',qualityLabel:'FHD',streamMode:'copy'
  }]));
  await page.reload();
  await expect(page.locator('.review-banner')).toBeVisible();
  for(const [width,height] of sizes){
    await resizeNative(width,height);
    await contained(['.home-page','.home-greeting-hero','.review-banner','.review-banner-open']);
    const overflow=await page.locator('.home-page').evaluate(el=>el.scrollWidth>el.clientWidth+1);
    expect(overflow).toBe(false);
    await page.locator('.review-banner-dismiss').scrollIntoViewIfNeeded();
    await expect(page.getByRole('button',{name:'Add playlist',exact:true})).toBeInViewport();
  }
});

test('keeps every screen and all settings categories usable across native window sizes and locales',async()=>{
  const playlistUrl='https://layout.example.test/channels.m3u';
  const channels=Array.from({length:400},(_,i)=>({id:`layout-${i}`,tvgId:`layout-${i}`,name:`Channel ${String(i).padStart(3,'0')}`,groupTitle:i%2?'Sports':'General',logoUrl:'',streamUrl:`https://layout.example.test/stream/${i}`,duration:-1,attributes:{}}));
  const now=Date.now();const programs=channels.flatMap(c=>[0,1].map(slot=>({channelId:c.id,title:`${slot?'Next':'Current'} ${c.name}`,subTitle:'',description:'',category:'',iconUrl:'',startUtc:new Date(now+(slot?30:-30)*60000).toISOString(),stopUtc:new Date(now+(slot?90:30)*60000).toISOString(),rawStart:'',rawStop:''})));
  const cache={schemaVersion:1,playlistUrlHash:createHash('sha256').update(playlistUrl).digest('hex').slice(0,16),epgUrlHash:'',parserVersion:'react-ts-v1',savedAtUtc:new Date().toISOString(),channels,programs,epgChannelDisplayNames:{},epgNormalizedNameMap:{}};
  await page.evaluate(async({s,cache})=>{await window.electron.saveSettings(s);await window.electron.saveCache(cache);},{s:{...settings,playlistUrl,favoriteChannelIds:channels.slice(0,6).map(c=>c.id)},cache});await page.reload();
  for(const language of ['en','pt-PT']){
    await page.evaluate(async lang=>{const s=await window.electron.loadSettings();await window.electron.saveSettings({...s,language:lang});},language);await page.reload();
    const labels=language==='en'?['Home','Live TV','Favorites','TV Guide','Statistics','Recordings','About','Settings']:['Início','TV em direto','Favoritos','Guia TV','Estatísticas','Gravações','Sobre','Definições'];
    const categories=language==='en'?['Sources','Playback','Appearance','Privacy','Advanced']:['Fontes','Reprodução','Aspeto','Privacidade','Avançadas'];
    for(const [width,height] of sizes){
      await resizeNative(width,height);
      for(const label of labels){
        await page.getByRole('button',{name:label,exact:true}).click();
        await page.screenshot({path:`output/layout/${language}-${width}-${label.replaceAll(' ','-')}.png`});
        await contained(['.page-header','.live-toolbar','.home-page','.review-banner','.settings-page','.settings-save-bar','.about-page','.stats-summary-grid','.recordings-header']);
        if(label===labels[7]){
          for(const category of categories){await page.getByRole('button',{name:category,exact:true}).click();await contained(['.settings-category-panel','.settings-group','.settings-save-bar']);await expect(page.locator('.settings-save-bar')).toBeInViewport();}
        }
      }
    }
  }
});
