const express = require('express');
const cron = require('node-cron');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const ONESIGNAL_APP_ID = '533fd092-0f2f-448a-bc77-3ba7f663e5ab';
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;

// ── MESSAGES ──
const DM = {
  morning: (n,d) => [`Good morning ${n} 🌅 Time for your ${d} — start the day right!`,`Rise and shine ${n}! Your ${d} is waiting 💊`,`Morning ${n}! Don't forget your ${d} 💪`],
  afternoon: (n,d) => [`Hey ${n}, your ${d} is due! Oya take it now 💊`,`Afternoon check ${n} — time for your ${d}. Don't skip!`,`${n} 2 seconds — take your ${d} now! 💊`],
  evening: (n,d) => [`Good evening ${n} 🌙 Last dose today — your ${d}`,`${n} before you sleep, take your ${d} 💊`,`Evening ${n}! Last ${d} for today 🌙`]
};
const WM = (n,h) => {
  if(h<10) return [`Good morning ${n}! Start with a full glass of water 💧`,`${n} wake up! Drink water before your phone 💧`,`Morning ${n}! Your body dey thirsty — hydrate! 💧`];
  if(h<14) return [`Oya ${n}, hydration check! One glass now 💧`,`${n} you don forget water o! 3 seconds — drink am now 😄💧`,`Quick water break ${n} — dehydration dey cause headache! 💧`];
  if(h<18) return [`Afternoon ${n} — stay hydrated! 💧`,`${n} water time! No dulling 💧`,`Halfway through the day ${n} — drink water 💧`];
  return [`Evening ${n} — keep drinking water 💧`,`${n} last few water reminders today — drink up! 💧`,`Almost bedtime ${n}! One more glass 💧`];
};
const MM = {
  b: (n) => [`Good morning ${n}! Go chop breakfast — your body needs fuel 🍳`,`${n} you never chop since morning? Abeg eat! 😄🍽`,`Breakfast time ${n}! Don't skip 🍳`],
  l: (n) => [`Lunchtime ${n}! No be only work — go chop 😄🍽`,`Oya ${n} your stomach don complain — go eat lunch 🍽`,`${n} lunch break — your body deserves it 🍽`],
  d: (n) => [`Dinner time ${n} 🌙 Eat well and rest tonight`,`${n} wrap up the day — eat your dinner 🍽`,`Evening meal time ${n}! Chop well so you sleep well 🌙`]
};
const PM = (n,days) => days<=1
  ? `Hey ${n} 🌸 Your period may arrive today or tomorrow. Take care 💕`
  : `Hey ${n} 🌸 Your period may be coming in ${days} days. Stay prepared!`;

function pick(arr){return arr[Math.floor(Math.random()*arr.length)];}
function toMins(t){if(!t)return -1;const[h,m]=t.split(':').map(Number);return h*60+m;}

// Get current time in user's timezone
function nowMinsInTZ(tz){
  try{
    const now = new Date();
    const str = now.toLocaleTimeString('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false});
    const [h,m] = str.split(':').map(Number);
    return h*60+m;
  }catch(e){
    // Fallback to WAT (Nigeria) if timezone invalid
    const wat = new Date(new Date().getTime()+(1*60*60*1000));
    return wat.getUTCHours()*60+wat.getUTCMinutes();
  }
}

function nowHourInTZ(tz){
  try{
    const now = new Date();
    const str = now.toLocaleTimeString('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false});
    return parseInt(str.split(':')[0]);
  }catch(e){
    const wat = new Date(new Date().getTime()+(1*60*60*1000));
    return wat.getUTCHours();
  }
}

function nowDateInTZ(tz){
  try{
    const now = new Date();
    return new Date(now.toLocaleString('en-GB',{timeZone:tz}));
  }catch(e){
    return new Date(new Date().getTime()+(1*60*60*1000));
  }
}

// ── COMPRESS schedule — short keys to stay under 500 char limit ──
function compress(schedule){
  const obj = {
    n: schedule.name||'Friend',
    d: schedule.sel?.drug?1:0,
    w: schedule.sel?.water?1:0,
    m: schedule.sel?.meal?1:0,
    p: schedule.sel?.period?1:0,
    ws: schedule.waterStart||'07:00',
    we: schedule.waterEnd||'21:00',
    mb: schedule.meals?.b||'08:00',
    ml: schedule.meals?.l||'13:00',
    md: schedule.meals?.d||'19:00',
    lp: schedule.lastPeriod||'',
    cl: schedule.cycleLen||28,
    sd: schedule.startDate||new Date().toISOString().split('T')[0],
    tz: schedule.timezone||'Africa/Lagos',
    dr: (schedule.drugs||[]).map(drug=>({
      n: drug.name,
      f: drug.food,
      t: drug.times,
      du: drug.dur,
      s: drug.start
    }))
  };
  return JSON.stringify(obj,null,0);
}

function decompress(str){
  const o = JSON.parse(str);
  return {
    name: o.n,
    sel: {drug:!!o.d, water:!!o.w, meal:!!o.m, period:!!o.p},
    waterStart: o.ws,
    waterEnd: o.we,
    meals: {b:o.mb, l:o.ml, d:o.md},
    lastPeriod: o.lp,
    cycleLen: o.cl||28,
    startDate: o.sd,
    timezone: o.tz||'Africa/Lagos',
    drugs: (o.dr||[]).map(d=>({name:d.n, food:d.f, times:d.t, dur:d.du, start:d.s}))
  };
}

async function sendToUser(title,body,playerId){
  try{
    await axios.post('https://onesignal.com/api/v1/notifications',
      {app_id:ONESIGNAL_APP_ID,headings:{en:title},contents:{en:body},include_player_ids:[playerId]},
      {headers:{'Content-Type':'application/json','Authorization':`Basic ${ONESIGNAL_API_KEY}`}}
    );
    console.log(`✅ Sent: ${title}`);
  }catch(e){console.error('Send error:',e.response?.data||e.message);}
}

async function getAllUsers(){
  try{
    const r = await axios.get(
      `https://onesignal.com/api/v1/players?app_id=${ONESIGNAL_APP_ID}&limit=300`,
      {headers:{'Authorization':`Basic ${ONESIGNAL_API_KEY}`}}
    );
    const players = r.data.players||[];
    console.log(`👥 Found ${players.length} user(s)`);
    return players;
  }catch(e){console.error('Get users error:',e.message);return[];}
}

async function checkAndSend(){
  const now = new Date();
  console.log(`⏰ Server UTC: ${now.toUTCString()} — checking reminders`);
  const users = await getAllUsers();
  if(!users.length){console.log('No users yet');return;}

  for(const user of users){
    const tags = user.tags||{};
    const id = user.id;
    if(!id) continue;

    let S;
    try{
      S = tags.schedule ? decompress(tags.schedule) : null;
    }catch(e){
      console.log(`⚠️ Bad schedule for ${id.slice(0,8)}`);
      continue;
    }
    if(!S){console.log(`⚠️ No schedule for ${id.slice(0,8)}`);continue;}

    const name = S.name||'Friend';
    const tz = S.timezone||'Africa/Lagos';
    const cur = nowMinsInTZ(tz);
    const h = nowHourInTZ(tz);
    const localNow = nowDateInTZ(tz);

    console.log(`👤 ${name} | TZ: ${tz} | Local time: ${h}:${String(cur%60).padStart(2,'0')} (${cur}mins)`);

    // DRUGS
    if(S.sel.drug && S.drugs?.length){
      for(const drug of S.drugs){
        if(!drug.name) continue;
        if(drug.dur<9999 && drug.start){
          const end=new Date(drug.start);end.setDate(end.getDate()+drug.dur);
          if(new Date()>end){console.log(`⏩ ${drug.name} expired`);continue;}
          if(cur===toMins('09:00')){
            const dl=Math.ceil((end-now)/(1000*60*60*24));
            if(dl===2) await sendToUser(`⚠️ VitaPing — ${drug.name}`,`${name}, your ${drug.name} ends in 2 days. Please see your doctor or pharmacist.`,id);
          }
        }
        const fn=drug.food==='before'?' (before your meal)':drug.food==='after'?' (after your meal)':drug.food==='with'?' (with your meal)':'';
        for(const dt of (drug.times||[])){
          if(!dt) continue;
          const diff = Math.abs(toMins(dt)-cur);
          console.log(`  💊 ${drug.name} at ${dt}(${toMins(dt)}mins) | now=${cur}mins | diff=${diff}`);
          if(diff<=1){
            const tod=h<12?'morning':h<17?'afternoon':'evening';
            await sendToUser(`💊 VitaPing — ${drug.name}`,pick(DM[tod](name,drug.name))+fn,id);
          }
        }
      }
    }

    // WATER
    if(S.sel.water){
      const ws=toMins(S.waterStart||'07:00');
      const we=toMins(S.waterEnd||'21:00');
      console.log(`  💧 Water: ${S.waterStart}-${S.waterEnd} | now=${cur}mins`);
      if(cur>=ws && cur<=we){
        if((cur-ws)%120<=1){
          await sendToUser('💧 VitaPing',pick(WM(name,h)),id);
        }
      }
    }

    // MEALS
    if(S.sel.meal && S.meals){
      const map={b:'Breakfast',l:'Lunch',d:'Dinner'};
      for(const [key,mt] of Object.entries(S.meals)){
        if(!mt) continue;
        const diff=Math.abs(toMins(mt)-cur);
        console.log(`  🍽 ${map[key]} at ${mt}(${toMins(mt)}mins) | now=${cur}mins | diff=${diff}`);
        if(diff<=1){
          await sendToUser(`🍽 VitaPing — ${map[key]}`,pick(MM[key](name)),id);
        }
      }
    }

    // PERIOD
    if(S.sel.period && S.lastPeriod && cur===toMins('09:00')){
      const alertDay=new Date(S.lastPeriod);
      alertDay.setDate(alertDay.getDate()+(S.cycleLen||28)-3);
      const today=new Date(localNow);today.setHours(0,0,0,0);alertDay.setHours(0,0,0,0);
      if(alertDay.getTime()===today.getTime()){
        await sendToUser('🩸 VitaPing',PM(name,3),id);
      }
    }
  }
}

cron.schedule('* * * * *',()=>checkAndSend().catch(console.error));

app.get('/',(req,res)=>res.json({
  status:'VitaPing backend running ✅',
  time:new Date().toISOString(),
  watTime: new Date(new Date().getTime()+(1*60*60*1000)).toUTCString()
}));

app.post('/register',async(req,res)=>{
  const {playerId,schedule} = req.body;
  if(!playerId||!schedule) return res.status(400).json({error:'Missing data'});
  try{
    const compressed = compress(schedule);
    console.log(`📦 ${schedule.name} | TZ: ${schedule.timezone} | Size: ${compressed.length} chars`);
    if(compressed.length>490){
      return res.status(400).json({error:'Too many drugs — max 3 medications'});
    }
    const tags = {
      name: schedule.name||'Friend',
      schedule: compressed,
      v: '3'
    };
    await axios.put(
      `https://onesignal.com/api/v1/players/${playerId}`,
      {app_id:ONESIGNAL_APP_ID,tags},
      {headers:{'Content-Type':'application/json','Authorization':`Basic ${ONESIGNAL_API_KEY}`}}
    );
    console.log(`✅ Registered: ${schedule.name} (${compressed.length} chars) TZ:${schedule.timezone}`);
    res.json({success:true,message:`Registered ${schedule.name}`});
  }catch(e){
    console.error('Register error:',e.response?.data||e.message);
    res.status(500).json({error:'Registration failed'});
  }
});

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>{
  console.log(`🚀 VitaPing backend on port ${PORT}`);
  console.log(`⏰ Checking reminders every minute`);
});
