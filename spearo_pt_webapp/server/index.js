const express = require("express");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname,"../public")));

function score(wave, period, wind){
  if([wave,period,wind].some(v=>typeof v!=="number")) return null;
  let s=8;
  if(wave<=0.8)s+=1;
  else if(wave<=1.2)s+=0.4;
  else if(wave>=1.8)s-=2;
  if(period>=8 && period<=10)s+=0.5;
  if(period>11)s-=0.5;
  if(wind<=8)s+=0.5;
  else if(wind>15)s-=1.5;
  return Math.max(0,Math.min(10,s));
}
function classify(s){
 if(s==null)return ["🟡","Sem classificação"];
 if(s>=8.5)return ["🟢","Muito interessante"];
 if(s>=7)return ["🟡","Boas condições"];
 if(s>=5)return ["🟠","Com reservas"];
 return ["🔴","Mar exigente"];
}

app.get("/api/spot",async(req,res)=>{
 try{
  const name=req.query.name||"Spot";
  const url="https://api.ipma.pt/open-data/forecast/oceanography/daily/hp-daily-sea-forecast-day0.json";
  const r=await fetch(url);
  if(!r.ok) throw new Error("IPMA "+r.status);
  const j=await r.json();
  const row=(j.data||[]).find(x=>String(x.globalIdLocal)==="1130826");
  if(!row) throw new Error("Porto coast not found");
  const waveMin=Number(row.waveHighMin), waveMax=Number(row.waveHighMax);
  const perMin=Number(row.wavePeriodMin), perMax=Number(row.wavePeriodMax);
  const wave=(waveMin+waveMax)/2, period=(perMin+perMax)/2;
  const temp=(Number(row.sstMin)+Number(row.sstMax))/2;
  // Daily IPMA ocean endpoint has no wind/energy fields: do not invent them.
  const s=score(wave,period,null), [emoji,status]=classify(s);
  res.json({
   score:s,status,statusEmoji:emoji,
   wave:`${waveMin.toFixed(1)}–${waveMax.toFixed(1)} m`,
   period:`${perMin.toFixed(1)}–${perMax.toFixed(1)} s`,
   direction:row.predWaveDir||"—",
   waterTemp:Number.isFinite(temp)?`${temp.toFixed(1)} °C`:"—",
   wind:"Não disponível neste endpoint",
   gust:"Não disponível neste endpoint",
   energy:"Não disponível neste endpoint",
   visibility:"Não confirmada",
   summary:`IPMA — ${row.forecastDate||"hoje"}`,
   note:"Dados reais da IPMA para a costa do Porto. Este endpoint diário não fornece vento, energia ou visibilidade por spot; esses campos só serão preenchidos quando uma fonte adequada for ligada."
  });
 }catch(e){
  res.status(502).json({error:e.message});
 }
});
app.listen(PORT,()=>console.log(`Spearo PT em http://localhost:${PORT}`));