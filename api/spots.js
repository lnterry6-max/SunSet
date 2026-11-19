/**
 * GET /api/spots?lat=42.263&lon=-71.802&radius=15
 * Cached, bounded OpenStreetMap Overpass lookup. No user-supplied query bodies.
 * Returns only real OSM elements. On upstream failure, returns 503 so the
 * browser can retain its existing cached or clearly-sourced fallback places.
 */
const SOURCES = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];
function makeQuery(lat, lon, miles) {
  const south = Math.max(-90, lat - miles / 69.0);
  const north = Math.min(90, lat + miles / 69.0);
  const offset = miles / Math.max(0.15, 69.0 * Math.cos(lat * Math.PI / 180));
  const west = Math.max(-180, lon - offset);
  const east = Math.min(180, lon + offset);
  const bbox = [south,west,north,east].map(v=>v.toFixed(5)).join(',');
  const selectors = [
    '["tourism"="viewpoint"]',
    '["natural"~"^(peak|cliff|saddle|beach|cape)$"]',
    '["man_made"="pier"]',
    '["leisure"~"^(marina|park|nature_reserve)$"]',
    '["waterway"="dock"]'
  ];
  return `[out:json][timeout:9];(${selectors.map(selector=>`nwr${selector}["name"](${bbox});`).join('')});out center 220;`;
}
async function requestElements(endpoint, query, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method:'POST',
      headers:{
        'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent':'SunSetScenicFinder/4.0 (+https://github.com/lnterry6-max/SunSet)',
        'Accept':'application/json'
      },
      body:new URLSearchParams({data:query}),
      signal:controller.signal
    });
    if(!response.ok) throw new Error(`Upstream response ${response.status}`);
    const result=await response.json();
    if(!Array.isArray(result.elements)) throw new Error('Invalid upstream response');
    return result.elements;
  } finally {clearTimeout(timer);}
}
module.exports = async function handler(req,res) {
  if(req.method!=='GET') {
    res.setHeader('Allow','GET');
    return res.status(405).json({error:'Method not allowed'});
  }
  const query=req.query || new URL(req.url,'https://sunset.local').searchParams;
  const field=k=>typeof query.get==='function' ? query.get(k) : query[k];
  const lat=Number(field('lat')),lon=Number(field('lon')),radius=Number(field('radius'));
  if(!Number.isFinite(lat)||lat<-89||lat>89||!Number.isFinite(lon)||lon<-180||lon>180||!Number.isInteger(radius)||radius<1||radius>50) {
    res.setHeader('Cache-Control','no-store');
    return res.status(400).json({error:'Valid lat, lon, and radius (1–50 miles) required'});
  }
  const q=makeQuery(lat,lon,radius);
  for(let i=0;i<SOURCES.length;i++) {
    try {
      const elements=await requestElements(SOURCES[i],q,i===0?5100:3600);
      res.setHeader('Cache-Control','public, s-maxage=43200, stale-while-revalidate=86400');
      res.setHeader('X-SunSet-Source',i===0?'primary':'secondary');
      return res.status(200).json({elements,source:'osm',fallback:i===1});
    } catch(e) {
      if(i===SOURCES.length-1) {
        res.setHeader('Cache-Control','no-store');
        return res.status(503).json({error:'Live map data temporarily unavailable. Try again shortly.'});
      }
    }
  }
};
