'use strict';
const {auth,send} = require('./_push-core.cjs');
const ORIGIN='https://dateungusto.com.mx';
exports.handler=async(event)=>{
  const headers={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Content-Type':'application/json'};
  if(event.headers?.origin && event.headers.origin!==ORIGIN) return {statusCode:403,headers,body:JSON.stringify({error:'Origen no permitido'})};
  if(event.httpMethod==='OPTIONS') return {statusCode:204,headers,body:''};
  if(event.httpMethod!=='POST') return {statusCode:405,headers,body:'{}'};
  try{
    const bearer=event.headers?.authorization||event.headers?.Authorization||'';
    if(!bearer.startsWith('Bearer ')) return {statusCode:401,headers,body:'{}'};
    const user=await auth().verifyIdToken(bearer.slice(7),true);
    const sent=await send(user.uid,{title:'Date un Gusto 🔔',body:'¡Tu notificación de prueba llegó correctamente!',tag:'dug-test',screen:'orders'});
    return {statusCode:200,headers,body:JSON.stringify({sent})};
  }catch(e){console.error('test push',e.message);return {statusCode:500,headers,body:JSON.stringify({error:'No se pudo enviar la prueba'})};}
};
