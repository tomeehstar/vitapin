const express = require('express');
const cron = require('node-cron');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const ONESIGNAL_APP_ID = '533fd092-0f2f-448a-bc77-3ba7f663e5ab';
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;

// Messages
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
const PERIOD_MSG = (n,days) => days<=1 ? `Hey ${n} 🌸 Your period may arrive today or tomorrow. Take care 💕` : `Hey ${n} 🌸 Your period may be coming in ${days} days. Stay prepared!`;

function pick(arr){return arr[Math.floor(Math.random()*arr.length)];}
function toMins(t){if(!t)return -1;const[h,m]=t.split(':').map(Number);return h*60+m;}
function nowMins(){const n=new Date();return n.getHours()*60+n.getMinutes();}
function nowHour(){return new Date().getHours();}

async function sendToUser(title,body,playerId){
  try{
    await axios.post('https://onesignal.com/api/v1/notifications',
      {app_id:ONESIGNAL_APP_ID,headings:{en:title},contents:{en:body},include_player_ids:[playerId]},
      {headers:{'Content-Type':'application/json','Authorization':`Basic ${ONESIGNAL_API_KEY}`}}
    );
    console.log(`✅ Sent to ${playerId}: ${title}`);
  }catch(e){console.error('Send error:',e.response?.data||e.message);}
}

async function getAllUsers(){
  try{
    const r=await axios.get(`https://onesignal.com/api/v1/players?app_id=${ONESIGNAL_APP_ID}&limit=300`,
      {headers:{'Authorization':`Basic ${ONESIGNAL_API_KEY}`}}
    );
    return r.data.players||[];
  }catch(e){console.error('Get users error:',e.message);return[];}
}

async function checkAndSend(){
  const cur=nowMins();
  const h=nowHour();
  const now=new Date();
  console.log(`⏰ ${now.toLocaleTimeString()} — checking reminders`);
  const users=await getAllUsers();
  if(!users.length){console.log('No users yet');return;}

  for(const user of users){
    const tags=user.tags||{};
    const name=tags.name||'Friend';
    const id=user.id;
    if(!id)continue;

    // DRUGS
    if(tags.has_drugs==='1'){
      for(let i=1;i<=3;i++){
        const dname=tags[`drug${i}_name`];
        if(!dname)continue;
        const food=tags[`drug${i}_food`]||'any';
        const fn=food==='before'?' (before your meal)':food==='after'?' (after your meal)':food==='with'?' (with your meal)':'';
        for(let t=1;t<=3;t++){
          const dt=tags[`drug${i}_t${t}`];
          if(!dt)continue;
          if(Math.abs(toMins(dt)-cur)<=1){
            const tod=h<12?'morning':h<17?'afternoon':'evening';
            await sendToUser(`💊 VitaPing — ${dname}`,pick(DRUG_MSGS[tod](name,dname))+fn,id);
          }
        }
        // 2 day warning at 9am
        const dur=parseInt(tags[`drug${i}_dur`])||9999;
        const start=tags[`drug${i}_start`];
        if(dur<9999&&start&&cur===toMins('09:00')){
          const end=new Date(start);end.setDate(end.getDate()+dur);
          const dl=Math.ceil((end-now)/(1000*60*60*24));
          if(dl===2)await sendToUser(`⚠️ VitaPing — ${dname}`,`${name}, your ${dname} course ends in 2 days. Please see your doctor or pharmacist.`,id);
        }
      }
    }

    // WATER
    if(tags.has_water==='1'){
      const ws=toMins(tags.water_start||'07:00');
      const we=toMins(tags.water_end||'21:00');
      if(cur>=ws&&cur<=we){
        const sinceStart=cur-ws;
        if(sinceStart%120<=1){
          await sendToUser('💧 VitaPing',pick(WATER_MSGS(name,h)),id);
        }
      }
    }

    // MEALS
    if(tags.has_meal==='1'){
      const meals={b:tags.meal_b,l:tags.meal_l,d:tags.meal_d};
      for(const[key,mt] of Object.entries(meals)){
        if(!mt)continue;
        if(Math.abs(toMins(mt)-cur)<=1){
          const lbl=key==='b'?'Breakfast':key==='l'?'Lunch':'Dinner';
          await sendToUser(`🍽 VitaPing — ${lbl}`,pick(MEAL_MSGS[key](name)),id);
        }
      }
    }

    // PERIOD — check at 9am
    if(tags.has_period==='1'&&tags.last_period&&cur===toMins('09:00')){
      const cl=parseInt(tags.cycle_len)||28;
      const alert=new Date(tags.last_period);
      alert.setDate(alert.getDate()+cl-3);
      const today=new Date();today.setHours(0,0,0,0);alert.setHours(0,0,0,0);
      if(alert.getTime()===today.getTime()){
        await sendToUser('🩸 VitaPing',PERIOD_MSG(name,3),id);
      }
    }
  }
}

// Run every minute
cron.schedule('* * * * *',()=>checkAndSend().catch(console.error));

// Routes
app.get('/',(req,res)=>res.json({status:'VitaPing backend running ✅',time:new Date().toISOString()}));

app.post('/register',async(req,res)=>{
  const{playerId,schedule}=req.body;
  if(!playerId||!schedule)return res.status(400).json({error:'Missing data'});
  try{
    const tags={
      name:schedule.name||'Friend',
      has_drugs:schedule.sel?.drug?'1':'0',
      has_water:schedule.sel?.water?'1':'0',
      has_meal:schedule.sel?.meal?'1':'0',
      has_period:schedule.sel?.period?'1':'0',
      water_start:schedule.waterStart||'07:00',
      water_end:schedule.waterEnd||'21:00',
      meal_b:schedule.meals?.b||'08:00',
      meal_l:schedule.meals?.l||'13:00',
      meal_d:schedule.meals?.d||'19:00',
      last_period:schedule.lastPeriod||'',
      cycle_len:String(schedule.cycleLen||28),
    };
    if(schedule.drugs?.length){
      schedule.drugs.forEach((drug,i)=>{
        const n=i+1;
        tags[`drug${n}_name`]=drug.name;
        tags[`drug${n}_food`]=drug.food;
        tags[`drug${n}_dur`]=String(drug.dur);
        tags[`drug${n}_start`]=drug.start;
        drug.times.forEach((t,ti)=>{ tags[`drug${n}_t${ti+1}`]=t; });
      });
    }
    await axios.put(
      `https://onesignal.com/api/v1/players/${playerId}`,
      {app_id:ONESIGNAL_APP_ID,tags},
      {headers:{'Content-Type':'application/json','Authorization':`Basic ${ONESIGNAL_API_KEY}`}}
    );
    console.log(`✅ Registered: ${tags.name}`);
    res.json({success:true,message:`Registered ${tags.name}`});
  }catch(e){
    console.error('Register error:',e.message);
    res.status(500).json({error:'Registration failed'});
  }
});

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>{
  console.log(`🚀 VitaPing backend on port ${PORT}`);
  console.log(`⏰ Checking reminders every minute`);
});
