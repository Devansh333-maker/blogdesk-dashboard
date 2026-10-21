const groups:Record<string,[string,string[]]>={
  'System 1':['', ['52wh','52wl','price-rise','price-fall']],
  'System 2':['', ['near-52wh','near-52wl','near-ath','near-atl']],
  'Old URL System':['', ['old-url-52wh','old-url-52wl','old-url-price-rise','old-url-price-fall']],
  'Funds & Circuits':['', ['mutual-funds','upper-circuit','lower-circuit']],
  'Quarterly Results':['', ['quarterly-results']],
  'Nifty 50 Market Update':['', ['opening-bell','midday','closing-bell']],
  'Gift Nifty Market Update':['', ['gift-nifty-market-update']],
  'Nifty Index Updates':['', ['top-gainers','top-losers','sector-updates']],
  'SEO Team Blogs':['', ['seo-draft-blogs','seo-auto-publish','seo-validate-articles']],
};
const names:Record<string,string>={'52wh':'52-Week High','52wl':'52-Week Low','price-rise':'Price Rise','price-fall':'Price Fall','near-52wh':'Near 52-Week High','near-52wl':'Near 52-Week Low','near-ath':'Near All-Time High','near-atl':'Near All-Time Low','mutual-funds':'Mutual Funds','upper-circuit':'Upper Circuit','lower-circuit':'Lower Circuit','quarterly-results':'Quarterly Results','opening-bell':'Opening Bell','midday':'Midday Update','closing-bell':'Closing Bell','gift-nifty-market-update':'Gift Nifty Market Update','top-gainers':'Top 2 Gainers','top-losers':'Top 2 Losers','sector-updates':'Sector Updates','seo-draft-blogs':'Draft Blogs','seo-auto-publish':'Auto Publish Blogs','seo-validate-articles':'Validate Articles'};
export const blogCategory = (id:string) => ({name:names[id]||names[id.replace(/^old-url-/,'')]||id,group:Object.entries(groups).find(([,value])=>value[1].includes(id))?.[0]||'Historical variations'});
