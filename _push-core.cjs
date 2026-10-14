'use strict';
const admin = require('firebase-admin');
const webpush = require('web-push');
const SITE = 'https://dateungusto.com.mx/';
let ready = false;
function setup(){
  if(ready) return;
  if(!process.env.DUG_FIREBASE_SERVICE_ACCOUNT_JSON || !process.env.DUG_VAPID_PRIVATE_KEY || !process.env.DUG_VAPID_PUBLIC_KEY) throw Error('Faltan variables de entorno privadas');
  const serviceAccount = JSON.parse(process.env.DUG_FIREBASE_SERVICE_ACCOUNT_JSON);
  if(!admin.apps.length) admin.initializeApp({credential:admin.credential.cert(serviceAccount)});
  webpush.setVapidDetails(process.env.DUG_PUSH_CONTACT || 'mailto:admin@dateungusto.com.mx', process.env.DUG_VAPID_PUBLIC_KEY, process.env.DUG_VAPID_PRIVATE_KEY);
  ready = true;
}
function firestore(){setup();return admin.firestore();}
function auth(){setup();return admin.auth();}
function safeEndpoint(endpoint){
  try{
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && (
      u.hostname === 'fcm.googleapis.com' || u.hostname === 'updates.push.services.mozilla.com' ||
      u.hostname === 'web.push.apple.com' || u.hostname.endsWith('.push.apple.com') ||
      u.hostname === 'wns2-pn1p.notify.windows.com' || u.hostname.endsWith('.notify.windows.com')
    );
  }catch{return false;}
}
async function send(uid, payload){
  if(!uid) return 0;
  const db=firestore();
  const subs=await db.collection('users').doc(uid).collection('pushSubscriptions').limit(30).get();
  let sent=0;
  for(const doc of subs.docs){
    const d=doc.data();
    if(!safeEndpoint(d.endpoint) || !d.keys?.p256dh || !d.keys?.auth) continue;
    try{
      await webpush.sendNotification({endpoint:d.endpoint,keys:d.keys},JSON.stringify({...payload,url:SITE}),{TTL:3600});sent++;
    }catch(e){
      if([404,410].includes(e.statusCode)) await doc.ref.delete();
      else console.error('push delivery failed',e.statusCode||e.message);
    }
  }
  return sent;
}
function admins(){return [...new Set((process.env.DUG_ADMIN_UIDS||'').split(',').map(x=>x.trim()).filter(Boolean))];}
module.exports={firestore,auth,send,admins};
