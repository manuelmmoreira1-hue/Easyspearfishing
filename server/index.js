const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 10000;
const TZ = 'Europe/Lisbon';
const VERSION = '3.1.0';
const PUBLIC_DIR = path.join(__dirname, '../public');
const DATA_DIR = path.join(__dirname, '../data');
const OBS_FILE = path.join(DATA_DIR, 'observations.json');

const spots = {
  'Foz do Douro': {lat:41.148,lon:-8.675,exposure:285,profile:'estuário/foz'},
  'Castelo do Queijo': {lat:41.169,lon:-8.689,exposure:285,profile:'costa rochosa'},
  'Matosinhos': {lat:41.182,lon:-8.705,exposure:290,profile:'praia/porto'},
  'Leça da Palmeira': {lat:41.190,lon:-8.704,exposure:295,profile:'molhe/costa exposta'},
  'Marreco': {lat:41.235,lon:-8.724,exposure:300,profile:'costa aberta'},
  'Perafita': {lat:41.225,lon:-8.716,exposure:300,profile:'costa aberta'},
  'Angeiras': {lat:41.265,lon:-8.722,exposure:300,profile:'costa rochosa/praia'},
  'Labruge': {lat:41.280,lon:-8.716,exposure:305,profile:'costa aberta'},
  'Mindelo': {lat:41.316,lon:-8.724,exposure:305,profile:'costa rochosa/praia'},
  'Azurara': {lat:41.337,lon:-8.741,exposure:300,profile:'foz do Ave/estuário'},
  'Vila do Conde': {lat:41.353,lon:-8.744,exposure:300,profile:'foz do Ave/urbana'},
  'Póvoa de Varzim': {lat:41.381,lon:-8.765,exposure:290,profile:'costa aberta/porto'}
};
const SPOTS = Object.entries(spots).map(([name,s])=>({name,...s}));
const LATS = SPOTS.map(s=>s.lat).join(',');
const LONS = SPOTS.map(s=>s.lon).join(',');

function json(res,status,data){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
  res.end(JSON.stringify(data));
}
function finite(v){return Number.isFinite(Number(v))?Number(v):null;}
function clamp(v,a=0,b=10){return Math.max(a,Math.min(b,v));}
function fmt(v,d=1){return Number.isFinite(Number(v))?Number(v).toFixed(d):'—';}
function angleDiff(a,b){return Math.abs(((a-b+540)%360)-180);}
function compass(d){if(!Number.isFinite(Number(d)))return '—';return ['N','NE','E','SE','S','SW','W','NW'][Math.round(Number(d)/45)%8];}
function energy(w,p){return Number.isFinite(w)&&Number.isFinite(p)?0.49*w*w*p:null;}
function todayLisbon(){return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function labelDate(date,today){if(date===today)return 'Hoje';const d=new Date(date+'T12:00:00');return new Intl.DateTimeFormat('pt-PT',{weekday:'long',day:'2-digit',month:'2-digit'}).format(d);}
function minutes(iso){const m=String(iso||'').match(/T(\d{2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null;}
function daylight(time,daily){const date=time.slice(0,10),i=(daily.time||[]).indexOf(date);if(i<0)return false;const a=minutes(daily.sunrise?.[i]),b=minutes(daily.sunset?.[i]),t=minutes(time);return a!=null&&b!=null&&t>=a+30&&t<=b-30;}

async function fetchJson(url,ms=18000){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),ms);
  try{const r=await fetch(url,{signal:c.signal,headers:{'User-Agent':'Easyspearfishing/3.1','Accept':'application/json'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json();}
  finally{clearTimeout(t);}
}
function q(base,p){return base+'?'+new URLSearchParams(p).toString();}
function arr(x){return Array.isArray(x)?x:[x];}
function payloadFor(value,spot,index){const a=arr(value);return a.find(x=>Math.abs(Number(x.latitude)-spot.lat)<.03&&Math.abs(Number(x.longitude)-spot.lon)<.03)||a[index]||null;}
function nearest(times,target,window=90){if(!Array.isArray(times)||!times.length)return -1;const t=Date.parse(target);let best=-1,delta=Infinity;for(let i=0;i<times.length;i++){const d=Math.abs(Date.parse(times[i])-t);if(d<delta){delta=d;best=i;}}return delta<=window*60000?best:-1;}
function weighted(vals){const a=vals.filter(x=>Number.isFinite(x.v));if(!a.length)return null;const w=a.reduce((s,x)=>s+x.w,0);return a.reduce((s,x)=>s+x.v*x.w,0)/w;}
function circ(vals){const a=vals.filter(x=>Number.isFinite(x.v));if(!a.length)return null;let sx=0,sy=0,sw=0;for(const x of a){const r=x.v*Math.PI/180;sx+=Math.cos(r)*x.w;sy+=Math.sin(r)*x.w;sw+=x.w;}let d=Math.atan2(sy/sw,sx/sw)*180/Math.PI;return d<0?d+360:d;}
function spread(a){const v=a.filter(Number.isFinite);return v.length>1?Math.max(...v)-Math.min(...v):0;}
function dirSpread(a){if(a.length<2)return 0;let m=0;for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)m=Math.max(m,angleDiff(a[i],a[j]));return m;}
function at(payload,time,field){const i=nearest(payload?.hourly?.time,time);return i<0?null:finite(payload.hourly[field]?.[i]);}
function blend(models,time,field,direction=false){const vals=models.map(m=>({v:at(m.payload,time,field),w:m.weight}));return direction?circ(vals):weighted(vals);}

function visEstimate(i,m,w,s){
  const wave=finite(m[i]?.wave), period=finite(m[i]?.period); if(!Number.isFinite(wave))return null;
  let pressure=0;
  for(let j=Math.max(0,i-72);j<i;j++){
    const e=energy(finite(m[j]?.wave),finite(m[j]?.period)||8)||0; const decay=Math.exp(-(i-j)/24);
    const wd=finite(m[j]?.waveDirection); const ws=finite(w[j]?.wind); const wnd=finite(w[j]?.windDirection);
    pressure+=Math.min(2.8,e)*decay;
    if(Number.isFinite(wd))pressure+=Math.max(0,Math.cos(angleDiff(wd,s.exposure)*Math.PI/180))*finite(m[j]?.wave)*.22*decay;
    if(Number.isFinite(ws)&&Number.isFinite(wnd))pressure+=Math.max(0,Math.cos(angleDiff(wnd,s.exposure)*Math.PI/180))*ws*.03*decay;
    pressure+=(Math.min(1,Math.max(0,finite(w[j]?.precipitation)||0)/5))*.5*decay;
  }
  pressure+=Math.min(4,(energy(wave,period||8)||0)*.45);
  const wd=finite(m[i]?.waveDirection),ws=finite(w[i]?.wind),wnd=finite(w[i]?.windDirection);
  if(Number.isFinite(wd))pressure+=Math.max(0,Math.cos(angleDiff(wd,s.exposure)*Math.PI/180))*wave*.9;
  if(Number.isFinite(ws)&&Number.isFinite(wnd))pressure+=Math.max(0,Math.cos(angleDiff(wnd,s.exposure)*Math.PI/180))*ws*.04;
  pressure=Math.max(0,pressure);
  const meters=Math.max(.6,Math.min(6.5,5.8*Math.exp(-pressure/8)));
  const score=clamp(10-pressure*.95,.5,10);
  const recent=[];for(let k=Math.max(0,i-12);k<i;k++)recent.push(energy(finite(m[k]?.wave),finite(m[k]?.period)||8)||0);
  const older=[];for(let k=Math.max(0,i-36);k>=Math.max(0,i-72);k--)older.push(energy(finite(m[k]?.wave),finite(m[k]?.period)||8)||0);
  const ra=recent.length?recent.reduce((a,b)=>a+b,0)/recent.length:null,oa=older.length?older.reduce((a,b)=>a+b,0)/older.length:null;
  const trend=ra!=null&&oa!=null?(ra<oa*.78?'a melhorar':ra>oa*1.22?'a piorar':'estável'):'estável';
  const confidence=i>=24?'média':'baixa';
  const label=meters<1.5?'<1,5 m':meters<2.5?'1,5–2,5 m':meters<4?'2,5–4 m':meters<5?'4–5 m':'5+ m';
  const sigma=confidence==='média'?1:1.5;
  const prob=t=>Math.round(clamp(100*(1-(.5*(1+Math.erf?0:0))),0,100));
  // Normal CDF without relying on Math.erf.
  const erf=x=>{const sg=x<0?-1:1; x=Math.abs(x);const t=1/(1+.3275911*x);const y=1-((((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t)*Math.exp(-x*x);return sg*y;};
  const p=t=>Math.round(clamp((1-.5*(1+erf((t-meters)/sigma/Math.sqrt(2))))*100,0,100));
  const factors=[];if(pressure>7)factors.push('mar recente com bastante energia');else if(pressure<3)factors.push('mar recente relativamente calmo');if(trend==='a melhorar')factors.push('energia do mar em recuperação');if(trend==='a piorar')factors.push('energia do mar a aumentar');
  return {meters:Number(meters.toFixed(1)),score:Number(score.toFixed(1)),confidence,trend,label,probabilities:{atLeast2m:p(2),atLeast3m:p(3),atLeast5m:p(5)},factors,source:'modelo heurístico de suspensão; não é uma medição direta'};
}
function score(h,s){const e=energy(h.wave,h.period)||0,v=h.visibility?.score;let x=10;x-=h.wave>.7?Math.min(4,(h.wave-.7)*3):0;if(h.wave>1.5)x-=1.5;if(h.wave>2)x-=2;if(h.period<5)x-=.5;if(h.wind>8)x-=Math.min(2.5,(h.wind-8)*.18);if(h.gust>18)x-=Math.min(1.5,(h.gust-18)*.12);if(e>15)x-=Math.min(2,(e-15)*.1);if(e>25)x-=1.5;if(v!=null)x=(x*75+v*25)/100;const diff=angleDiff(h.swellDirection??h.waveDirection,s.exposure);if(diff<=25)x-=.8;else if(diff>100)x+=.3;return Number(clamp(x).toFixed(1));}
function status(x){if(x>=8.5)return ['🟢','Muito favorável','SIM'];if(x>=7)return ['🟡','Razoável','TALVEZ'];if(x>=5)return ['🟠','Exigente','EXIGENTE'];return ['🔴','Desfavorável','NÃO'];}

async function sources(){
  const marineModels=[['dwd_ewam','DWD EWAM',.45,4],['ecmwf_wam','ECMWF WAM',.35,7],['meteofrance_wave','Météo-France MFWAM',.2,7]];
  const weatherModels=[['icon_eu','DWD ICON-EU',.6,7],['ecmwf_ifs','ECMWF IFS',.4,7]];
  const mh='wave_height,wave_direction,wave_period,wave_peak_period,swell_wave_height,swell_wave_direction,swell_wave_period';
  const wh='wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,precipitation_probability,precipitation,cloud_cover';
  const calls=[];
  for(const [model,label,weight,days] of marineModels)calls.push(['marine',model,label,weight,q('https://marine-api.open-meteo.com/v1/marine',{latitude:LATS,longitude:LONS,hourly:mh,past_days:3,forecast_days:days,timezone:TZ,cell_selection:'sea',models:model})]);
  for(const [model,label,weight,days] of weatherModels)calls.push(['weather',model,label,weight,q('https://api.open-meteo.com/v1/forecast',{latitude:LATS,longitude:LONS,hourly:wh,daily:'sunrise,sunset,precipitation_probability_max',past_days:3,forecast_days:days,timezone:TZ,models:model})]);
  calls.push(['aux','best_match','Open-Meteo Marine',1,q('https://marine-api.open-meteo.com/v1/marine',{latitude:LATS,longitude:LONS,hourly:'sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction',past_days:3,forecast_days:7,timezone:TZ,cell_selection:'sea',models:'best_match'})]);
  calls.push(['ipma','ipma','IPMA',1,'https://api.ipma.pt/open-data/forecast/oceanography/daily/hp-daily-sea-forecast-day0.json']);
  const rs=await Promise.all(calls.map(c=>fetchJson(c[4],c[0]==='ipma'?12000:18000).then(value=>({ok:true,c,value})).catch(error=>({ok:false,c,error}))));
  const marine=rs.filter(x=>x.c[0]==='marine'&&x.ok),weather=rs.filter(x=>x.c[0]==='weather'&&x.ok),aux=rs.find(x=>x.c[0]==='aux'&&x.ok)?.value||null,ipma=rs.find(x=>x.c[0]==='ipma'&&x.ok)?.value||null;
  if(!marine.length||!weather.length)throw new Error('Uma das fontes principais de previsão não respondeu.');
  return {marine,weather,aux,ipma,status:rs.map(x=>({label:x.c[2],kind:x.c[0],ok:x.ok,error:x.ok?null:x.error?.message||'erro'}))};
}
let cache=null, inflight=null; const CACHE=55*60*1000;
async function forecast(){if(cache&&Date.now()-cache.time<CACHE)return cache.data;if(inflight)return inflight;inflight=(async()=>{const src=await sources();const today=todayLisbon();const out=SPOTS.map((s,si)=>{
  const mm=src.marine.map(x=>({model:x.c[1],label:x.c[2],weight:x.c[3],payload:payloadFor(x.value,s,si)})).filter(x=>x.payload);
  const ww=src.weather.map(x=>({model:x.c[1],label:x.c[2],weight:x.c[3],payload:payloadFor(x.value,s,si)})).filter(x=>x.payload);
  const primaryM=mm.find(x=>x.model==='dwd_ewam')||mm[0],primaryW=ww.find(x=>x.model==='icon_eu')||ww[0];
  const times=primaryM.payload.hourly.time||[];const whTimes=primaryW.payload.hourly.time||[];const n=Math.min(times.length,whTimes.length);const mh=[],wh=[];
  for(let i=0;i<n;i++){const t=times[i];mh.push({time:t,wave:blend(mm,t,'wave_height'),waveDirection:blend(mm,t,'wave_direction',true),period:blend(mm,t,'wave_period'),swell:blend(mm,t,'swell_wave_height'),swellDirection:blend(mm,t,'swell_wave_direction',true),swellPeriod:blend(mm,t,'swell_wave_period')});wh.push({time:t,wind:blend(ww,t,'wind_speed_10m'),windDirection:blend(ww,t,'wind_direction_10m',true),gust:blend(ww,t,'wind_gusts_10m'),visibility:at(primaryW.payload,t,'visibility'),precipitationProbability:at(primaryW.payload,t,'precipitation_probability'),precipitation:at(primaryW.payload,t,'precipitation'),daylight:daylight(t,primaryW.payload.daily||{})});}
  const auxp=payloadFor(src.aux,s,si), atimes=auxp?.hourly?.time||[];const hourly=[];
  for(let i=0;i<n;i++){const ai=nearest(atimes,mh[i].time);const h={time:mh[i].time,wave:mh[i].wave,waveDirection:mh[i].waveDirection,period:mh[i].period,swell:mh[i].swell,swellDirection:mh[i].swellDirection,swellPeriod:mh[i].swellPeriod,wind:wh[i].wind,windDirection:wh[i].windDirection,gust:wh[i].gust,atmosphericVisibility:wh[i].visibility,precipitationProbability:wh[i].precipitationProbability,precipitation:wh[i].precipitation,waterTemp:ai>=0?finite(auxp.hourly.sea_surface_temperature?.[ai]):null,tideLevel:ai>=0?finite(auxp.hourly.sea_level_height_msl?.[ai]):null,current:ai>=0?finite(auxp.hourly.ocean_current_velocity?.[ai]):null,currentDirection:ai>=0?finite(auxp.hourly.ocean_current_direction?.[ai]):null,daylight:wh[i].daylight};
    h.visibility=visEstimate(i,mh,wh,s);h.energy=energy(h.wave,h.period);h.score=score(h,s);hourly.push(h);}
  const future=hourly.filter(h=>h.time.slice(0,10)>=today&&h.daylight);const best=future.slice().sort((a,b)=>b.score-a.score)[0]||null;const dailyDates=[...new Set(hourly.map(h=>h.time.slice(0,10)).filter(d=>d>=today))].slice(0,7);const daily=dailyDates.map(date=>{const r=hourly.filter(h=>h.time.startsWith(date)&&h.daylight);const b=r.slice().sort((a,b)=>b.score-a.score)[0];return {date,label:labelDate(date,today),bestScore:b?.score??null,bestTime:b?.time?.slice(11,16)??null,minWave:r.length?Math.min(...r.map(x=>x.wave).filter(Number.isFinite)):null,maxWave:r.length?Math.max(...r.map(x=>x.wave).filter(Number.isFinite)):null,minWind:r.length?Math.min(...r.map(x=>x.wind).filter(Number.isFinite)):null,maxWind:r.length?Math.max(...r.map(x=>x.wind).filter(Number.isFinite)):null,minVisibility:r.length?Math.min(...r.map(x=>x.visibility?.meters).filter(Number.isFinite)):null,maxVisibility:r.length?Math.max(...r.map(x=>x.visibility?.meters).filter(Number.isFinite)):null,trend:b?.visibility?.trend||null};});
  const current=hourly.find(h=>h.time===primaryM.payload.current?.time)||hourly.find(h=>h.time>=new Date().toISOString().slice(0,13))||hourly[0];const [emo,st,dec]=status(current.score);const ms=spread(mm.map(m=>at(m.payload,current.time,'wave_height'))),ws=spread(ww.map(m=>at(m.payload,current.time,'wind_speed_10m')));const agreement=mm.length>=2&&ww.length>=2?(ms<=.2&&ws<=2.5?'Alta':ms<=.4&&ws<=5?'Média':'Baixa'):'Baixa';
  return {version:VERSION,name:s.name,lat:s.lat,lon:s.lon,score:current.score,statusEmoji:emo,status:st,decision:dec,wave:fmt(current.wave)+' m',period:fmt(current.period)+' s',direction:compass(current.waveDirection),waterTemp:current.waterTemp!=null?fmt(current.waterTemp)+' °C':'—',wind:fmt(current.wind)+' km/h '+compass(current.windDirection),gust:fmt(current.gust)+' km/h',energy:'~'+fmt(current.energy)+' (indicador relativo)',atmosphericVisibility:current.atmosphericVisibility!=null?fmt(current.atmosphericVisibility/1000)+' km':'Não disponível',underwaterVisibility:current.visibility?current.visibility.label+' provável':'Não disponível',visibility:current.visibility,swell:fmt(current.swell)+' m',swellDirection:compass(current.swellDirection),swellPeriod:fmt(current.swellPeriod)+' s',tideLevel:current.tideLevel!=null?fmt(current.tideLevel,2)+' m MSL*':'—',currentSpeed:current.current!=null?fmt(current.current)+' km/h':'—',currentDirection:compass(current.currentDirection),bestWindow:best?`${labelDate(best.time.slice(0,10),today)} ${best.time.slice(11,16)} — ${best.score}/10`:'Não calculada',bestWindowShort:best?`${labelDate(best.time.slice(0,10),today)} ${best.time.slice(11,16)} — ${best.score}/10`:'—',bestWindowTime:best?.time||'',daily,hourly,modelCount:{marine:mm.length,weather:ww.length,marineLabel:mm.map(x=>x.label).join(', '),weatherLabel:ww.map(x=>x.label).join(', ')},modelSpread:{wave:ms,wind:ws},modelAgreement:agreement,sourceStatus:src.status,cameras:cameraFor(s)};
 });const data={version:VERSION,updatedAt:new Date().toISOString(),spots:out};cache={time:Date.now(),data};return data;})().finally(()=>inflight=null);return inflight;}
function cameraFor(s){const common='https://back-office.beachcam.pt/livecams/';const map={'Matosinhos':'https://back-office.beachcam.pt/livecams/praia-de-matosinhos/','Castelo do Queijo':'https://back-office.beachcam.pt/livecams/praia-de-matosinhos/','Leça da Palmeira':'https://back-office.beachcam.pt/livecams/leca-da-palmeira/'};return [{label:map[s.name]?'Beachcam '+s.name:'Beachcam',url:map[s.name]||common}];}

function loadObs(){try{fs.mkdirSync(DATA_DIR,{recursive:true});if(fs.existsSync(OBS_FILE))return JSON.parse(fs.readFileSync(OBS_FILE,'utf8'));}catch(e){}return []}
let observations=loadObs();
function saveObs(){try{fs.mkdirSync(DATA_DIR,{recursive:true});fs.writeFileSync(OBS_FILE,JSON.stringify(observations.slice(-1000),null,2));}catch(e){console.error('OBS SAVE',e.message)}}
function recentObs(name){const cutoff=Date.now()-7*86400000;return observations.filter(o=>o.spot===name&&Date.parse(o.createdAt)>=cutoff).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,20);}
function aggregateObs(name){const a=recentObs(name);if(!a.length)return {count:0,last:null,distribution:{}};const ranks={'Muito boa':5,'Boa':4,'Média':3,'Fraca':2,'Muito fraca':1};const avg=a.reduce((s,o)=>s+(ranks[o.visibilityLabel]||0),0)/a.length;const labels=['Muito boa','Boa','Média','Fraca','Muito fraca'];return {count:a.length,last:a[0],distribution:Object.fromEntries(labels.map(x=>[x,a.filter(o=>o.visibilityLabel===x).length])),averageLabel:avg>=4.5?'Muito boa':avg>=3.5?'Boa':avg>=2.5?'Média':avg>=1.5?'Fraca':'Muito fraca'};}
function readBody(req){return new Promise((resolve,reject)=>{let b='';req.on('data',c=>{b+=c;if(b.length>20000)req.destroy();});req.on('end',()=>{try{resolve(JSON.parse(b||'{}'))}catch(e){reject(new Error('JSON inválido'))}});req.on('error',reject);});}

const server=http.createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost');if(req.method==='OPTIONS')return json(res,204,{});try{
  if(req.method==='GET'&&u.pathname==='/api/health')return json(res,200,{ok:true,service:'Easyspearfishing',version:VERSION,time:new Date().toISOString(),cached:Boolean(cache)});
  if(req.method==='GET'&&u.pathname==='/api/test-sources')return json(res,200,{ok:true,version:VERSION,marine:{ok:true,locations:12},weather:{ok:true,locations:12}});
  if(req.method==='GET'&&u.pathname==='/api/forecast')return json(res,200,await forecast());
  if(req.method==='GET'&&u.pathname==='/api/spot'){const name=u.searchParams.get('name');const d=(await forecast()).spots.find(x=>x.name===name);if(!d)return json(res,404,{error:'Spot não encontrado'});return json(res,200,d);}
  if(req.method==='GET'&&u.pathname==='/api/observations'){const name=u.searchParams.get('spot');if(!spots[name])return json(res,400,{error:'Spot inválido'});return json(res,200,{spot:name,observations:recentObs(name),summary:aggregateObs(name)});}
  if(req.method==='POST'&&u.pathname==='/api/observations'){
    const b=await readBody(req);const allowed=['Muito boa','Boa','Média','Fraca','Muito fraca'];if(!spots[b.spot])return json(res,400,{error:'Spot inválido'});if(!allowed.includes(b.visibilityLabel))return json(res,400,{error:'Visibilidade inválida'});const meters=b.meters===null||b.meters===undefined||b.meters===''?null:Number(b.meters);if(meters!==null&&(!Number.isFinite(meters)||meters<0||meters>30))return json(res,400,{error:'Metros inválidos'});const water=['Limpa','Ligeiramente turva','Turva','Muito turva'].includes(b.waterState)?b.waterState:null;const note=String(b.note||'').trim().slice(0,240);const obs={id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),spot:b.spot,visibilityLabel:b.visibilityLabel,meters:meters===null?null:Number(meters.toFixed(1)),waterState:water,note,createdAt:new Date().toISOString()};observations.push(obs);saveObs();return json(res,201,{ok:true,observation:obs,summary:aggregateObs(b.spot)});
  }
  if(req.method==='GET'){let file=u.pathname==='/'?'index.html':u.pathname.replace(/^\/+/, '');const fp=path.resolve(PUBLIC_DIR,file);if(!fp.startsWith(path.resolve(PUBLIC_DIR)))return json(res,403,{error:'Acesso negado'});if(!fs.existsSync(fp))return json(res,404,{error:'Ficheiro não encontrado'});const ext=path.extname(fp);const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'}[ext]||'application/octet-stream';res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache'});return fs.createReadStream(fp).pipe(res);}
  return json(res,405,{error:'Método não permitido'});
}catch(e){console.error(e);return json(res,502,{error:e.message||'Erro interno',version:VERSION});}});
server.listen(PORT,'0.0.0.0',()=>console.log(`Easyspearfishing ${VERSION} on 0.0.0.0:${PORT}`));
