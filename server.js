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
const DRUG_MSGS = {
  morning: (n,d) => [`Good morning ${n} 🌅 Time for your ${d} — start the day right!`,`Rise and shine ${n}! Your ${d} is waiting 💊`,`Morning ${n}! Don't forget your ${d} 💪`],
  afternoon: (n,d) => [`Hey ${n}, your ${d} is due! Oya take it now 💊`,`Afternoon check ${n} — time for your ${d}. Don't skip!`,`${n} 2 seconds — take your ${d} now! 💊`],
  evening: (n,d) => [`Good evening ${n} 🌙 Last dose today — your ${d}`,`${n} before you sleep, take your ${d} 💊`,`Evening ${n}! Last ${d} for today 🌙`]
};
const WATER_MSGS = (n,h) => {
  if(h<10) return [`Good morning ${n}! Start with a full glass of water 💧`,`${n} wake up! Drink water before your phone 💧`,`Morning ${n}! Your body dey thirsty — hydrate! 💧`];
  if(h<14) return [`Oya ${n}, hydration check! One glass now 💧`,`${n} you don forget water o! 3 seconds — drink am now 😄💧`,`Quick water break ${n} — dehydration dey cause headache! 💧`];
  if(h<18) return [`Afternoon ${n} — stay hydrated! 💧`,`${n} water time! No dulling 💧`,`Halfway through the day ${n} — drink water 💧`];
  return [`Evening ${n} — keep drinking water 💧`,`${n} last few water reminders today — drink up! 💧`,`Almost bedtime ${n}! One more glass 💧`];
};
const MEAL_MSGS = {
  b: (n) => [`Good morning ${n}! Go chop breakfast — your body needs fuel 🍳`,`${n} you never chop since morning? Abeg eat! 😄🍽`,`Breakfast time ${n}! Don't skip 🍳`],
  l: (n) => [`Lunchtime ${n}! No be only work — go chop 😄🍽`,`Oya ${n} your stomach don complain — go eat lunch 🍽`,`${n} lunch break — your body deserves it 🍽`],
  d: (n) => [`Dinner time ${n} 🌙 Eat well and rest tonight`,`${n} wrap up the day — eat your dinner 🍽`,`Evening meal time ${n}! Chop well so you sleep well 🌙`]
};
const PERIOD_MSG = (n,days) => days<=1
  ? `Hey ${n} 🌸 Your period may arrive today or tomorrow. Take care 💕`
  : `Hey ${n} 🌸 Your period may be coming in ${days} days. Stay prepared!`;

// ── HELPERS ──
function pick(arr){return arr[Math.floor(Math.random()*arr.length)];}
function toMins(t){if(!t)return -1;const[h,m]=t.split(':').map(Number);return h*60+m;}
function nowMins(){const n=new Date();return n.getHours()*60+n.getMinutes();}
function nowHour(){return new Date().getHours();}

// ── SEND NOTIFICATION ──
async function sendToUser(title,body,playerId){
  try{
    const r = await axios.post('https://onesignal.com/api/v1/notifications',
      {app_id:ONESIGNAL_APP_ID,headings:{en:title},contents:{en:body},include_player_ids:[playerId]},
      {headers:{'Content-Type':'application/json','Authorization':`Basic ${ONESIGNAL_API_KEY}`}}
    );
    console.log(`✅ Sent to ${playerId.slice(0,8)}...: ${title}`);
  }catch(e){
    console.error('Send error:',e.response?.data||e.message);
  }
}

// ── GET ALL USERS ──
async function getAllUsers(){
  try{
    const r = await axios.get(
      `https://onesignal.com/api/v1/players?app_id=${ONESIGNAL_APP_ID}&limit=300`,
      {headers:{'Authorization':`Basic ${ONESIGNAL_API_KEY}`}}
    );
    const players = r.data.players||[];
    console.log(`👥 Found ${players.length} user(s)`);
    return players;
  }catch(e){
    console.error('Get users error:',e.response?.data||e.message);
    return[];
  }
}

// ── CHECK AND SEND REMINDERS ──
async function checkAndSend(){
  const cur = nowMins();
  const h = nowHour();
  const now = new Date();
  console.log(`⏰ ${now.toLocaleTimeString()} — checking reminders`);

  const users = await getAllUsers();
  if(!users.length){console.log('No users yet');return;}

  for(const user of users){
    const tags = user.tags||{};
    const id = user.id;
    if(!id) continue;

    // Parse full schedule from single JSON tag
    let S;
    try{
      S = tags.schedule ? JSON.parse(tags.schedule) : null;
    }catch(e){
      console.log(`❌ Bad schedule for ${id}`);
      continue;
    }
    if(!S){console.log(`⚠️ No schedule for ${id}`);continue;}

    const name = S.name||'Friend';
    console.log(`👤 Checking: ${name}`);

    // DRUGS
    if(S.sel?.drug && S.drugs?.length){
      for(const drug of S.drugs){
        if(!drug.name) continue;
        // Check if course expired
        if(drug.dur < 9999 && drug.start){
          const end = new Date(drug.start);
          end.setDate(end.getDate()+drug.dur);
          if(new Date() > end){
            console.log(`⏩ ${drug.name} course expired`);
            continue;
          }
          // 2 day warning at 9am
          if(cur === toMins('09:00')){
            const dl = Math.ceil((end-now)/(1000*60*60*24));
            if(dl===2){
              await sendToUser(
                `⚠️ VitaPing — ${drug.name}`,
                `${name}, your ${drug.name} course ends in 2 days. Please see your doctor or pharmacist for a refill.`,
                id
              );
            }
          }
        }
        const food = drug.food||'any';
        const fn = food==='before'?' (before your meal)':food==='after'?' (after your meal)':food==='with'?' (with your meal)':'';
        for(const dt of (drug.times||[])){
          if(!dt) continue;
          if(Math.abs(toMins(dt)-cur)<=1){
            const tod = h<12?'morning':h<17?'afternoon':'evening';
            console.log(`💊 Sending ${drug.name} reminder to ${name} at ${dt}`);
            await sendToUser(
              `💊 VitaPing — ${drug.name}`,
              pick(DRUG_MSGS[tod](name,drug.name))+fn,
              id
            );
          }
        }
      }
    }

    // WATER — every 2 hours from start time
    if(S.sel?.water){
      const ws = toMins(S.waterStart||'07:00');
      const we = toMins(S.waterEnd||'21:00');
      if(cur>=ws && cur<=we){
        const sinceStart = cur-ws;
        if(sinceStart%120<=1){
          console.log(`💧 Sending water reminder to ${name}`);
          await sendToUser('💧 VitaPing',pick(WATER_MSGS(name,h)),id);
        }
      }
    }

    // MEALS
    if(S.sel?.meal && S.meals){
      const mealMap = {b:'Breakfast',l:'Lunch',d:'Dinner'};
      for(const [key,mt] of Object.entries(S.meals)){
        if(!mt) continue;
        if(Math.abs(toMins(mt)-cur)<=1){
          console.log(`🍽 Sending ${mealMap[key]} reminder to ${name} at ${mt}`);
          await sendToUser(
            `🍽 VitaPing — ${mealMap[key]}`,
            pick(MEAL_MSGS[key](name)),
            id
          );
        }
      }
    }

    // PERIOD — check at 9am daily
    if(S.sel?.period && S.lastPeriod && cur===toMins('09:00')){
      const cl = parseInt(S.cycleLen)||28;
      const alertDay = new Date(S.lastPeriod);
      alertDay.setDate(alertDay.getDate()+cl-3);
      const today = new Date();
      today.setHours(0,0,0,0);
      alertDay.setHours(0,0,0,0);
      if(alertDay.getTime()===today.getTime()){
        console.log(`🩸 Sending period alert to ${name}`);
        await sendToUser('🩸 VitaPing',PERIOD_MSG(name,3),id);
      }
    }
  }
}

// ── CRON — every minute ──
cron.schedule('* * * * *', ()=>checkAndSend().catch(console.error));

// ── ROUTES ──
app.get('/', (req,res)=>{
  res.json({status:'VitaPing backend running ✅', time:new Date().toISOString()});
});

// Register user — save all data in just 3 tags
app.post('/register', async(req,res)=>{
  const {playerId, schedule} = req.body;
  if(!playerId||!schedule){
    return res.status(400).json({error:'Missing playerId or schedule'});
  }
  try{
    console.log(`📥 Register request: ${schedule.name} — Player: ${playerId}`);

    // Pack everything into 3 tags only — OneSignal free limit
    const tags = {
      name: schedule.name||'Friend',
      schedule: JSON.stringify({
        name: schedule.name||'Friend',
        sel: schedule.sel||{},
        drugs: schedule.drugs||[],
        waterStart: schedule.waterStart||'07:00',
        waterEnd: schedule.waterEnd||'21:00',
        waterDur: schedule.waterDur||365,
        meals: schedule.meals||{b:'08:00',l:'13:00',d:'19:00'},
        mealDur: schedule.mealDur||365,
        lastPeriod: schedule.lastPeriod||'',
        cycleLen: schedule.cycleLen||28,
        startDate: schedule.startDate||new Date().toISOString().split('T')[0]
      }),
      updated: new Date().toISOString()
    };

    console.log(`🏷️ Sending 3 tags to OneSignal for player: ${playerId}`);

    await axios.put(
      `https://onesignal.com/api/v1/players/${playerId}`,
      {app_id:ONESIGNAL_APP_ID, tags},
      {headers:{'Content-Type':'application/json','Authorization':`Basic ${ONESIGNAL_API_KEY}`}}
    );

    console.log(`✅ Registered: ${schedule.name}`);
    res.json({success:true, message:`Registered ${schedule.name}`});

  }catch(e){
    console.error('Register error:', e.response?.data||e.message);
    res.status(500).json({error:'Registration failed', details: e.response?.data});
  }
});

// ── START ──
const PORT = process.env.PORT||3000;
app.listen(PORT, ()=>{
  console.log(`🚀 VitaPing backend on port ${PORT}`);
  console.log(`⏰ Checking reminders every minute`);
});
