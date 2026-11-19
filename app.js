/* SunSet — no API keys required. Data: Open-Meteo and OpenStreetMap/Overpass. */
(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const els = {
    form: $('#search-form'), location: $('#location-input'), radius: $('#radius-input'), radiusValue: $('#radius-value'),
    searchButton: $('#search-button'), nearby: $('#nearby-button'), status: $('#status'), list: $('#spot-list'),
    count: $('#results-count'), subtitle: $('#results-subtitle'), solarChip: $('#solar-chip'), solarText: $('#solar-time-text'),
    categories: $('#category-filters'), more: $('#show-more'), saved: $('#saved-filter'), sort: $('#sort-select')
  };

  const US_STATES = {
    AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',
    FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',
    LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',
    MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',
    NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',
    RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',
    VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',DC:'District of Columbia'
  };
  const MAX_SPOTS = 85;
  const SPOT_TTL = 7 * 24 * 60 * 60 * 1000;
  const REFRESH_AFTER = 3 * 24 * 60 * 60 * 1000;
  const GEO_TTL = 30 * 24 * 60 * 60 * 1000;
  const SOLAR_TTL = 30 * 60 * 1000;
  const PER_PAGE = 8;
  const PHOTO = {
    water: 'https://images.unsplash.com/photo-1717518577846-b547438b7116?auto=format&fit=crop&w=480&q=75',
    mountains: 'https://images.unsplash.com/photo-1756749746289-cca49a38021e?auto=format&fit=crop&w=480&q=75',
    coast: 'https://images.unsplash.com/photo-1717518577846-b547438b7116?auto=format&fit=crop&w=480&q=75',
    lookouts: 'https://images.unsplash.com/photo-1756749746289-cca49a38021e?auto=format&fit=crop&w=480&q=75',
    parks: 'https://images.unsplash.com/photo-1756749746289-cca49a38021e?auto=format&fit=crop&w=480&q=75'
  };
  const DESCRIPTIONS = {
    water: 'A waterfront setting worth exploring. Check which direction the shoreline faces for the best light.',
    mountains: 'An elevated landscape that may offer an expansive horizon. Confirm trail access and conditions.',
    coast: 'A coastal setting with potential for beautiful sky colors over the water.',
    lookouts: 'A mapped scenic viewpoint—check whether it faces the rising or setting sun.',
    parks: 'A public green space to slow down and enjoy the changing sky. Check park hours.'
  };
  const LABELS = {water:'Waterfront',mountains:'Mountain views',coast:'Coastal view',lookouts:'Scenic lookout',parks:'Park & nature'};
  const state = {
    mode: 'sunset', radius: 15, category: 'all', sort: 'best', savedOnly: false, limit: PER_PAGE,
    place: null, spots: [], request: null, map: null, markerLayer: null, radiusCircle: null, locationPin: null,
    lastQuery: '', placeIsGps: false, ratings: readStore('sunset-ratings', {}), favorites: readStore('sunset-favorites', []),
    spotCache: readStore('sunset-spots-v2', {}), geoCache: readStore('sunset-geocodes-v2', {}),
    solarCache: readStore('sunset-solar-v2', {}), solar: null
  };

  function readStore(key, fallback) { try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; } catch { return fallback; } }
  function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be unavailable */ } }
  function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function distanceMiles(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180, a = Math.sin((lat2-lat1)*r/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin((lon2-lon1)*r/2)**2;
    return 3958.76 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
  function titleCase(v) { return String(v).toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); }
  function getCoords(el) {
    const lat = Number(el.lat ?? el.center?.lat), lon = Number(el.lon ?? el.center?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? {lat,lon} : null;
  }
  function classify(tags) {
    if (tags.tourism === 'viewpoint') return 'lookouts';
    if (tags.natural === 'peak' || tags.natural === 'cliff' || tags.natural === 'saddle') return 'mountains';
    if (tags.natural === 'beach' || tags.natural === 'cape') return 'coast';
    if (tags.man_made === 'pier' || tags.leisure === 'marina' || tags.waterway === 'dock') return 'water';
    if (tags.leisure === 'park' || tags.leisure === 'nature_reserve') return 'parks';
    return null;
  }
  function getViewScore(spot, mode) {
    // Transparent heuristic, not a surveyed horizon or community average.
    let score = {lookouts:4.65,mountains:4.45,coast:4.45,water:4.22,parks:3.95}[spot.category] ?? 3.5;
    const text = `${spot.name} ${spot.tags.description ?? ''}`.toLowerCase();
    if (/overlook|vista|panorama|scenic|summit|lookout|belvedere/.test(text)) score += .2;
    if (/sunset|sunrise|golden hour/.test(text)) score += .17;
    if (spot.category === 'mountains' && Number.parseFloat(spot.tags.ele) >= 400) score += .12;
    const direction = String(spot.tags.direction || spot.tags['viewpoint:direction'] || '').toUpperCase();
    if (direction && /^[NESW]{1,3}$/.test(direction)) {
      if ((mode === 'sunrise' && direction.includes('E')) || (mode === 'sunset' && direction.includes('W'))) score += .15;
      else if ((mode === 'sunrise' && direction === 'W') || (mode === 'sunset' && direction === 'E')) score -= .5;
    }
    return Math.min(5,Math.max(1, Math.round(score*10)/10));
  }
  function parseSpots(elements, place, radius) {
    const unique = new Map();
    for (const el of elements || []) {
      const tags = el.tags || {};
      if (!tags.name || tags.name.length < 3 || ['private','no','customers'].includes(tags.access) || tags.disused === 'yes' || tags.abandoned === 'yes') continue;
      const category = classify(tags), coords = getCoords(el);
      if (!category || !coords) continue;
      const distance = distanceMiles(place.latitude,place.longitude,coords.lat,coords.lon);
      if (distance > radius + .03) continue;
      const cleanName = tags.name.trim();
      const dedupeKey = cleanName.toLowerCase().replace(/[^a-z0-9]/g,'');
      const spot = {...coords, category, tags, name:cleanName, distance,
        id:`${el.type}-${el.id}`, osmType:el.type,osmId:el.id};
      const old = unique.get(dedupeKey);
      if (!old || getViewScore(spot,state.mode) > getViewScore(old,state.mode) || (getViewScore(spot,state.mode)===getViewScore(old,state.mode) && spot.distance < old.distance)) unique.set(dedupeKey,spot);
    }
    return [...unique.values()].sort((a,b) => getViewScore(b,state.mode)-getViewScore(a,state.mode) || a.distance-b.distance).slice(0,MAX_SPOTS);
  }
  // Use a few combined tag filters and a bounded response. The original query scanned
  // the same large area eleven times and requested up to 500 complete records.
  function buildOverpassQuery(lat, lon, radius) {
    const center = `around:${Math.round(radius*1609.344)},${lat.toFixed(5)},${lon.toFixed(5)}`;
    const criteria = [
      '["tourism"="viewpoint"]',
      '["natural"~"^(peak|cliff|saddle|beach|cape)$"]',
      '["man_made"="pier"]',
      '["leisure"~"^(marina|park|nature_reserve)$"]',
      '["waterway"="dock"]'
    ];
    return `[out:json][timeout:12];(${criteria.map(filter => `nwr(${center})${filter}["name"];`).join('')});out center 220;`;
  }
  async function requestJSON(url, {signal, timeoutMs = 8000, ...options} = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) throw new DOMException('Search canceled', 'AbortError');
    signal?.addEventListener('abort', abort, {once:true});
    let timedOut = false;
    const timer = setTimeout(() => { timedOut=true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetch(url, {...options, signal:controller.signal});
      if (!response.ok) throw new Error(response.status === 429 ? 'Map service is busy (rate-limited)' : `Service returned ${response.status}`);
      return await response.json();
    } catch (error) {
      if (timedOut && !signal?.aborted) throw new Error('Request timed out');
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  function cacheWrite(bucket, key, payload, limit) {
    state[bucket][key] = {at:Date.now(), value:payload};
    const keys = Object.keys(state[bucket]).sort((a,b)=>state[bucket][b].at-state[bucket][a].at);
    for (const oldKey of keys.slice(limit)) delete state[bucket][oldKey];
    const storeKeys = {spotCache:'sunset-spots-v2',geoCache:'sunset-geocodes-v2',solarCache:'sunset-solar-v2'};
    store(storeKeys[bucket],state[bucket]);
  }
  function cacheGet(bucket, key, lifetime) {
    const entry = state[bucket][key];
    return entry && Date.now() - entry.at < lifetime ? entry : null;
  }
  function locationKey(place) { return `${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`; }
  function cachedSpots(place, radius) {
    const center = locationKey(place);
    const entries = Object.entries(state.spotCache).filter(([key, entry])=>{
      const [where, range] = key.split(':');
      return where === center && Number(range) >= radius && entry?.value && Date.now()-entry.at < SPOT_TTL;
    }).sort((a,b)=>Number(a[0].split(':')[1])-Number(b[0].split(':')[1]));
    if (!entries.length) return null;
    const [key, entry] = entries[0];
    const spots = entry.value.map(spot => ({...spot, distance:distanceMiles(place.latitude,place.longitude,spot.lat,spot.lon)}))
      .filter(spot=>spot.distance <= radius+.03);
    return {spots, at:entry.at, exact:key === `${center}:${radius}`};
  }
  async function geocode(query, signal) {
    const parts = query.split(',').map(v=>v.trim()).filter(Boolean), city = parts[0];
    if (!city) throw new Error('Enter a city or town to begin.');
    const cacheKey = query.toLowerCase().replace(/\s+/g,' ').trim();
    const saved = cacheGet('geoCache',cacheKey,GEO_TTL);
    if (saved) return saved.value;
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=40&language=en&format=json`;
    const json = await requestJSON(url, {signal,timeoutMs:6500});
    if (!json.results?.length) throw new Error('We couldn’t find that city or town. Try adding its state or country.');
    const expectedRegion = (parts[1] || '').toLowerCase();
    const expandedRegion = (US_STATES[expectedRegion.toUpperCase()] || expectedRegion).toLowerCase();
    const expectedCountry = (parts[2] || '').toLowerCase();
    const candidates = json.results.map(place => {
      let weight = 0;
      if (place.name.toLowerCase() === city.toLowerCase()) weight += 12;
      else if (place.name.toLowerCase().startsWith(city.toLowerCase())) weight += 3;
      if (expandedRegion && (place.admin1 || '').toLowerCase() === expandedRegion) weight += 15;
      if (expectedRegion && (place.country || '').toLowerCase() === expectedRegion) weight += 13;
      if (expectedRegion && (place.country_code || '').toLowerCase() === expectedRegion) weight += 13;
      if (expectedCountry && ((place.country || '').toLowerCase() === expectedCountry || (place.country_code || '').toLowerCase() === expectedCountry || (expectedCountry === 'usa' && place.country_code === 'US'))) weight += 12;
      weight += Math.log10(Math.max(1,place.population || 1))*.3;
      return {place,weight};
    }).sort((a,b)=>b.weight-a.weight);
    const best = candidates[0].place;
    const place = {...best, displayName:[best.name,best.admin1,best.country].filter(Boolean).join(', ')};
    cacheWrite('geoCache',cacheKey,place,24);
    return place;
  }
  async function fetchSpots(place, radius, signal) {
    const query = buildOverpassQuery(place.latitude,place.longitude,radius);
    const endpoints = ['https://overpass.kumi.systems/api/interpreter','https://overpass-api.de/api/interpreter'];
    let lastError;
    for (const endpoint of endpoints) {
      try {
        const data = await requestJSON(endpoint, {
          method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
          body:new URLSearchParams({data:query}),signal,timeoutMs:8500
        });
        if (!Array.isArray(data.elements)) throw new Error('Unexpected map response');
        const spots = parseSpots(data.elements,place,radius);
        // Persist compact data only, so repeat searches and smaller radius searches are immediate.
        const compact = spots.map(s=>({...s,tags:{ele:s.tags.ele,description:s.tags.description,direction:s.tags.direction,
          'viewpoint:direction':s.tags['viewpoint:direction']}}));
        cacheWrite('spotCache',`${locationKey(place)}:${radius}`,compact,12);
        return compact;
      } catch (error) {
        if (signal.aborted) throw error;
        lastError=error;
      }
    }
    throw new Error(`Map data is taking too long right now. ${lastError?.message || 'Please try again shortly.'}`);
  }
  async function fetchSolar(place, signal) {
    const key = locationKey(place);
    const saved = cacheGet('solarCache',key,SOLAR_TTL);
    if (saved) return saved.value;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&daily=sunrise,sunset&timezone=auto&forecast_days=1`;
    const data = await requestJSON(url,{signal,timeoutMs:6000});
    const solar = data.daily?.sunrise?.length ? {day:data.daily.time?.[0],sunrise:data.daily.sunrise[0],sunset:data.daily.sunset[0],timezone:data.timezone} : null;
    if (solar) cacheWrite('solarCache',key,solar,24);
    return solar;
  }
  function formatLocalTime(iso) {
    if (!iso?.includes('T')) return 'Time unavailable';
    const [h,m] = iso.split('T')[1].slice(0,5).split(':').map(Number);
    return `${h%12 || 12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
  }
  function updateSolar() {
    const icon = state.mode === 'sunset' ? '◐' : '☀';
    const when = state.solar?.[state.mode];
    els.solarChip.querySelector('.solar-icon').textContent = icon;
    els.solarText.textContent = when ? `Today’s ${state.mode} · ${formatLocalTime(when)} local` : `${titleCase(state.mode)} time unavailable`;
  }
  function showStatus(type,title,message) {
    els.status.hidden=false;els.status.dataset.type=type;
    els.status.querySelector('strong').textContent=title;
    els.status.querySelector('p').textContent=message;
  }
  function setSearching(isSearching) {
    els.searchButton.disabled = isSearching;
    els.searchButton.querySelector('span:last-child').textContent = isSearching ? 'Finding spots…' : 'Find my spots';
  }
  function visibleSpots() {
    const items = state.spots.filter(s => (state.category === 'all' || s.category === state.category) && (!state.savedOnly || state.favorites.includes(s.id)));
    if (state.sort === 'nearest') items.sort((a,b)=>a.distance-b.distance);
    else if (state.sort === 'name') items.sort((a,b)=>a.name.localeCompare(b.name));
    else if (state.sort === 'rating') items.sort((a,b)=>(state.ratings[b.id]||0)-(state.ratings[a.id]||0) || getViewScore(b,state.mode)-getViewScore(a,state.mode));
    else items.sort((a,b)=>getViewScore(b,state.mode)-getViewScore(a,state.mode) || a.distance-b.distance);
    return items;
  }
  function cardHTML(spot) {
    const score = getViewScore(spot,state.mode), myRating = Number(state.ratings[spot.id] || 0);
    const isSaved = state.favorites.includes(spot.id);
    const params = new URLSearchParams({api:'1',destination:`${spot.lat},${spot.lon}`});
    const dir = `https://www.google.com/maps/dir/?${params}`;
    return `<article class="spot-card" id="card-${escapeHTML(spot.id)}">
      <div class="spot-photo"><img loading="lazy" decoding="async" src="${PHOTO[spot.category]}" alt="Illustrative ${LABELS[spot.category].toLowerCase()} landscape, not a photo of this specific spot"><span class="photo-caption">Illustrative photo</span></div>
      <div class="spot-body"><div class="spot-head"><div><div class="category-kicker">${escapeHTML(LABELS[spot.category])}</div><h3 class="spot-title">${escapeHTML(spot.name)}</h3></div><div class="spot-distance">${spot.distance < .1 ? '< 0.1' : spot.distance.toFixed(1)} mi</div></div>
      <p class="spot-description">${DESCRIPTIONS[spot.category]}</p>
      <div class="spot-bottom"><div class="spot-score"><span class="score-number"><span class="stars" aria-hidden="true">★</span> ${score.toFixed(1)} / 5</span><span class="score-label">Estimated view score</span></div>
      <div class="spot-actions"><button type="button" class="save-button ${isSaved?'saved':''}" data-save="${spot.id}" aria-label="${isSaved?'Remove from':'Add to'} saved spots: ${escapeHTML(spot.name)}" aria-pressed="${isSaved}">${isSaved?'♥':'♡'}</button><a href="${dir}" target="_blank" rel="noopener noreferrer" class="direction-link" aria-label="Directions to ${escapeHTML(spot.name)}">Directions ↗</a></div></div>
      <div class="personal-rating"><span>Your view rating (on this device)</span><div class="rating-buttons" role="group" aria-label="Rate ${escapeHTML(spot.name)}">${[1,2,3,4,5].map(n=>`<button type="button" data-rate="${spot.id}" data-stars="${n}" class="${n<=myRating?'filled':''}" aria-label="Rate ${n} ${n===1?'star':'stars'}" aria-pressed="${n===myRating}">★</button>`).join('')}</div></div>
      </div></article>`;
  }
  function render() {
    const spots = visibleSpots();
    els.count.textContent = state.place ? `${spots.length} ${spots.length===1?'place':'places'} within ${state.radius} miles` : 'Explore your nearby horizon';
    els.list.innerHTML = spots.slice(0,state.limit).map(cardHTML).join('');
    els.more.hidden = spots.length <= state.limit;
    if (state.place && !spots.length && els.status.hidden) showStatus('empty','No matching spots in this search','Try another scenery filter, switch off Saved, or increase your mile radius.');
    if (spots.length && els.status.dataset.type === 'empty') els.status.hidden=true;
    updateMap(spots);
  }
  function createMap() {
    if (state.map || !window.L) return;
    const root = $('#map');
    root.innerHTML='';
    state.map = L.map(root,{scrollWheelZoom:false,zoomControl:false}).setView([39.8,-98.6],4);
    L.control.zoom({position:'bottomright'}).addTo(state.map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>',maxZoom:18
    }).addTo(state.map);
    state.markerLayer=L.layerGroup().addTo(state.map);
  }
  function updateMap(spots) {
    if (!state.place) return;
    if (!window.L) {
      $('#map').innerHTML='<div class="map-fallback">The interactive map could not load. Directions links still work.</div>';
      return;
    }
    createMap();
    if (!state.map) return;
    state.markerLayer.clearLayers();
    if (state.radiusCircle) state.map.removeLayer(state.radiusCircle);
    if (state.locationPin) state.map.removeLayer(state.locationPin);
    const home=[state.place.latitude,state.place.longitude];
    state.radiusCircle=L.circle(home,{radius:state.radius*1609.344,color:'#c08a76',weight:1,fillColor:'#edc9b6',fillOpacity:.07,dashArray:'5,7'}).addTo(state.map);
    state.locationPin=L.circleMarker(home,{radius:6,color:'#fff',weight:2,fillColor:'#29344a',fillOpacity:1}).addTo(state.map).bindPopup('Search center');
    spots.slice(0,35).forEach((spot,i)=>{
      const marker=L.marker([spot.lat,spot.lon],{icon:L.divIcon({className:'',iconSize:[30,30],iconAnchor:[15,28],html:`<div class="map-marker"><span>${i+1}</span></div>`})});
      const mapsUrl=`https://www.google.com/maps/dir/?api=1&destination=${spot.lat}%2C${spot.lon}`;
      marker.bindPopup(`<strong>${escapeHTML(spot.name)}</strong><p>${escapeHTML(LABELS[spot.category])} · ${spot.distance.toFixed(1)} mi · ${getViewScore(spot,state.mode).toFixed(1)} / 5 estimated</p><a href="${mapsUrl}" target="_blank" rel="noopener noreferrer">Get directions ↗</a>`);
      marker.addTo(state.markerLayer);
    });
    const bounds=state.radiusCircle.getBounds();
    state.map.fitBounds(bounds,{padding:[20,20],maxZoom:12,animate:false});
    setTimeout(()=>state.map?.invalidateSize(),0);
  }
  // The UI is never blocked by the slow scenic-data provider: show the town and
  // daily solar times right away; show cached spots immediately when possible.
  async function search(locationOverride) {
    if (state.request) state.request.abort();
    const controller = new AbortController();
    state.request=controller;
    const signal=controller.signal;
    const radius=Number(els.radius.value);
    const rawLocation=els.location.value.trim();
    if (!locationOverride && !rawLocation) {
      setSearching(false);
      showStatus('error','A location is needed','Enter a city or town to find views.');
      state.request=null;
      return;
    }
    const usingGps = Boolean(locationOverride) || (state.placeIsGps && rawLocation.toLowerCase()==='current location');
    const placeFromPrevious = usingGps ? locationOverride || state.place : (rawLocation.toLowerCase()===state.lastQuery ? state.place : null);
    const previous = state.place;
    state.radius=radius;
    state.limit=PER_PAGE;
    setSearching(true);
    showStatus('loading','Finding your next golden hour…','Locating your town and nearby scenic spots.');
    els.subtitle.textContent='Locating scenic places near you…';
    try {
      const place = placeFromPrevious || await geocode(rawLocation, signal);
      if(signal.aborted) return;
      const centerChanged = !previous || distanceMiles(previous.latitude, previous.longitude, place.latitude, place.longitude) > .15;
      state.place = place;
      state.placeIsGps=usingGps;
      state.lastQuery=usingGps?'current location':rawLocation.toLowerCase();
      if(centerChanged) {state.spots=[];state.solar=null;}
      els.subtitle.textContent=`Scenic spots around ${place.displayName || 'your current location'} — selected for ${state.mode}.`;
      // Display the search radius/map without waiting for a third-party API.
      if(centerChanged) render(); else updateMap(visibleSpots());
      updateSolar();
      fetchSolar(place,signal).then(solar=>{
        if(signal.aborted) return;
        state.solar=solar;
        updateSolar();
      }).catch(()=>{if(!signal.aborted) updateSolar();});

      const cached=cachedSpots(place,radius);
      if (cached) {
        state.spots=cached.spots;
        els.status.hidden=true;
        render();
        if(Date.now()-cached.at < REFRESH_AFTER) return;
        showStatus('loading','Updating saved results…','Showing saved scenic spots while checking for recent map changes.');
      } else {
        state.spots=[];
        showStatus('loading','Scanning the scenic map…','Sunrise/sunset time and the search area appear first. Finding viewpoints, shores, peaks and parks may take a few seconds.');
        render();
      }
      try {
        const fresh=await fetchSpots(place,radius,signal);
        if(signal.aborted) return;
        state.spots=fresh;
        els.status.hidden=true;
        if(!fresh.length) showStatus('empty','No mapped spots found','Try a larger radius, or search a nearby city. Not all good viewpoints are mapped yet.');
        render();
      } catch(error) {
        if(signal.aborted) return;
        if(cached) {
          els.status.hidden=true;
          els.subtitle.textContent=`Showing saved scenic spots around ${place.displayName || 'your location'} — live map updates unavailable.`;
          render();
        } else {
          els.count.textContent='Could not load scenic spots';
          showStatus('error','The scenic-data service is busy',`${error?.message || 'Please try again.'} You can retry or choose a smaller radius.`);
        }
      }
    } catch(error) {
      if(signal.aborted) return;
      els.count.textContent='Could not find that location';
      showStatus('error','Location search failed',error?.message || 'Check the city name and try again.');
      els.subtitle.textContent='Try another city or use your current location.';
    } finally {
      if(state.request===controller) {state.request=null;setSearching(false);}
    }
  }
  function setMode(mode) {
    state.mode=mode;
    document.querySelectorAll('[data-mode]').forEach(btn=>{
      const active=btn.dataset.mode===mode;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',String(active));
    });
    if (state.place) els.subtitle.textContent=`Scenic places around ${state.place.displayName || 'your current location'} — selected for your ${mode}.`;
    updateSolar();render();
  }

  els.form.addEventListener('submit',e=>{e.preventDefault();search();});
  els.radius.addEventListener('input',()=>{els.radiusValue.textContent=`${els.radius.value} ${els.radius.value==='1'?'mile':'miles'}`;});
  els.radius.addEventListener('change',()=>{if(state.place) search(state.placeIsGps ? state.place : undefined);});
  document.querySelectorAll('[data-mode]').forEach(btn=>btn.addEventListener('click',()=>setMode(btn.dataset.mode)));
  els.categories.addEventListener('click',e=>{
    const btn=e.target.closest('[data-category]');if(!btn)return;
    state.category=btn.dataset.category;state.limit=PER_PAGE;
    els.categories.querySelectorAll('[data-category]').forEach(b=>{const selected=b===btn;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
    if(state.place){els.status.hidden=true;render();}
  });
  els.saved.addEventListener('click',()=>{state.savedOnly=!state.savedOnly;state.limit=PER_PAGE;els.saved.setAttribute('aria-pressed',String(state.savedOnly));if(state.place){els.status.hidden=true;render();}});
  els.sort.addEventListener('change',()=>{state.sort=els.sort.value;state.limit=PER_PAGE;if(state.place)render();});
  els.more.addEventListener('click',()=>{state.limit+=PER_PAGE;render();});
  els.list.addEventListener('click',e=>{
    const save=e.target.closest('[data-save]');
    if(save){const id=save.dataset.save;state.favorites=state.favorites.includes(id)?state.favorites.filter(v=>v!==id):[...state.favorites,id];store('sunset-favorites',state.favorites);render();return;}
    const rate=e.target.closest('[data-rate]');
    if(rate){const id=rate.dataset.rate,stars=Number(rate.dataset.stars);if(state.ratings[id]===stars)delete state.ratings[id];else state.ratings[id]=stars;store('sunset-ratings',state.ratings);render();}
  });
  els.nearby.addEventListener('click',()=>{
    if(!navigator.geolocation){showStatus('error','Location unavailable','Your browser does not support device location. Enter a city instead.');return;}
    showStatus('loading','Getting your location…','Your browser may ask you to allow location access.');
    navigator.geolocation.getCurrentPosition(({coords})=>{
      els.location.value='Current location';
      search({latitude:coords.latitude,longitude:coords.longitude,displayName:'your current location'});
    },()=>showStatus('error','Couldn’t access your location','Allow location access in your browser or search by city instead.'),{enableHighAccuracy:false,timeout:10000,maximumAge:300000});
  });
  // Run the initial city search so the home page immediately demonstrates real geographic results.
  search();
})();