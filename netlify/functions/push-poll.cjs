'use strict';
const {schedule}=require('@netlify/functions');
const {firestore,send,admins}=require('./_push-core.cjs');
// Consulta periódica; NO es una notificación instantánea.
// El primer ciclo establece la línea base para evitar avisar por pedidos antiguos.
const run=async()=>{
  const db=firestore();
  const marker=db.collection('pushMeta').doc('netlifyPollV1');
  const initialized=(await marker.get()).exists;
  const rows=[];
  for(const collection of ['orders','orderInbox']){
    const snap=await db.collection(collection).orderBy('updatedAtMs','desc').limit(250).get();
    for(const doc of snap.docs){
      const d=doc.data();
      if(!d.userId || !d.createdAtMs) continue;
      rows.push({ref:doc.ref,id:doc.id,collection,data:d});
    }
  }
  // Preferir orders sobre orderInbox para un mismo pedido cuando exista un reflejo.
  const canonicalIds=new Set(rows.filter(x=>x.collection==='orders').map(x=>x.id));
  const filtered=rows.filter(x=>x.collection==='orders'||(!canonicalIds.has(x.id)&&!canonicalIds.has(x.data.originalOrderId)));
  for(const o of filtered){
    const key=`${o.collection}_${o.id}`;
    const ref=db.collection('pushMeta').doc('order_'+key.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,900));
    const previous=await ref.get();
    const status=String(o.data.status||'nuevo');
    const lastUpdate=Number(o.data.updatedAtMs||o.data.createdAtMs||0);
    if(!previous.exists){
      await ref.set({status,lastUpdate,seenAt:Date.now()});
      if(initialized && Date.now()-Number(o.data.createdAtMs)<20*60*1000){
        for(const uid of admins()) await send(uid,{title:'Nuevo pedido · Date un Gusto',body:`Pedido ${String(o.data.folio||o.id).slice(0,45)} recibido`,tag:'new-'+o.id,screen:'private'});
      }
    }else if(previous.data().status!==status){
      await ref.set({status,lastUpdate,seenAt:Date.now()});
      await send(o.data.userId,{title:'Actualización de tu pedido',body:`Tu pedido ${String(o.data.folio||o.id).slice(0,45)}: ${status.slice(0,55)}`,tag:'status-'+o.id,screen:'orders'});
    }
  }
  if(!initialized) await marker.set({initializedAt:Date.now()});
};
exports.handler=schedule('*/5 * * * *',async()=>{try{await run();}catch(e){console.error('Scheduled push failed',e);throw e;}});
