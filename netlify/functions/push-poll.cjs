'use strict';

const { schedule } = require('@netlify/functions');
const { firestore, send, admins } = require('./_push-core.cjs');

const MINUTE = 60_000;

function customerMessage(order, folio) {
  switch (order.status) {
    case 'nuevo': return ['Recibimos tu pedido', `Tu pedido ${folio} está pendiente de confirmación.`];
    case 'preparando': return ['Estamos preparando tu pedido', `La tienda confirmó tu pedido ${folio} y ya empezó a prepararlo.`];
    case 'listo': return order.delivery === 'recoger'
      ? ['Tu pedido está listo para recoger', `Ya puedes pasar por el pedido ${folio}.`]
      : ['Tu pedido está listo', `El pedido ${folio} está preparado para salir.`];
    case 'en camino': return ['Tu pedido va en camino', `El pedido ${folio} ya salió para entrega.`];
    case 'entregado': return ['Pedido entregado', `Tu pedido ${folio} se marcó como entregado.`];
    case 'cancelado': return ['Pedido cancelado', `El pedido ${folio} se canceló. Consulta el detalle en la app.`];
    default: return null;
  }
}

function metaKey(collection, id) {
  return 'order_' + (collection + '_' + id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 900);
}

async function collectOrders(db) {
  const rows = [];
  for (const collection of ['orders', 'orderInbox']) {
    const snap = await db.collection(collection).orderBy('updatedAtMs', 'desc').limit(250).get();
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.userId && data.createdAtMs) rows.push({ collection, id: doc.id, data });
    }
  }
  const canonicalIds = new Set(rows.filter(row => row.collection === 'orders').map(row => row.id));
  return rows.filter(row => row.collection === 'orders' ||
    (!canonicalIds.has(row.id) && !canonicalIds.has(row.data.originalOrderId)));
}

async function claimEvents(db, order, initialized, now) {
  const { collection, id, data } = order;
  const meta = db.collection('pushMeta');
  const ref = meta.doc(metaKey(collection, id));
  const status = String(data.status || 'nuevo');
  const lastUpdate = Number(data.updatedAtMs || data.createdAtMs);

  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const fallback = !snapshot.exists && collection === 'orders'
      ? await transaction.get(meta.doc(metaKey('orderInbox', id)))
      : null;
    const previous = snapshot.data() || fallback?.data();
    const age = now - Number(data.createdAtMs);
    const changed = Boolean(previous && previous.status !== status);
    const arrived = Boolean(data.arrived);
    const statusSince = changed || !previous?.statusSince ? lastUpdate : previous.statusSince;
    const events = {
      received: initialized && !previous && age >= 0 && age < 20 * MINUTE && status === 'nuevo',
      changed,
      arrived: Boolean(previous && previous.arrived === false && arrived && status === 'listo'),
      unattended: initialized && status === 'nuevo' && age >= 5 * MINUTE && age < 60 * MINUTE && !previous?.unattended,
      pickupReminder: initialized && status === 'listo' && data.delivery === 'recoger' && !arrived &&
        now - statusSince >= 15 * MINUTE && now - statusSince < 60 * MINUTE && !previous?.pickupReminder
    };
    const next = {
      status, lastUpdate, arrived, statusSince,
      unattended: Boolean(previous?.unattended || events.unattended),
      pickupReminder: Boolean(previous?.pickupReminder || events.pickupReminder)
    };
    if (!snapshot.exists || Object.keys(next).some(key => next[key] !== previous[key])) {
      transaction.set(ref, next, { merge: true });
    }
    return events;
  });
}

async function run() {
  const db = firestore();
  const marker = db.collection('pushMeta').doc('netlifyPollV1');
  const initialized = (await marker.get()).exists;
  const now = Date.now();
  const adminIds = admins();
  for (const order of await collectOrders(db)) {
    const { id, data } = order;
    const events = await claimEvents(db, order, initialized, now);
    const folio = String(data.folio || id).slice(0, 45);
    const notify = (uid, title, body, tag, screen) => send(uid, { title, body, tag: tag + '-' + id, screen });
    const notifyAdmins = async (title, body, tag) => {
      for (const uid of adminIds) await notify(uid, title, body, tag, 'private');
    };

    if (events.received || events.changed) {
      const message = customerMessage({ ...data, status: data.status || 'nuevo' }, folio);
      if (message) await notify(data.userId, ...message, 'status', 'orders');
    }
    if (events.received) await notifyAdmins('Nuevo pedido por confirmar', `Recibiste el pedido ${folio}.`, 'new');
    if (events.unattended) await notifyAdmins('Pedido sin atender', `El pedido ${folio} sigue pendiente de confirmar.`, 'unattended');
    if (events.arrived) await notifyAdmins('El cliente ya llegó', `El cliente del pedido ${folio} está en el punto de recogida.`, 'arrived');
    if (events.pickupReminder) {
      await notify(data.userId, 'Recuerda recoger tu pedido', `El pedido ${folio} sigue listo para recoger.`, 'pickup', 'orders');
      await notifyAdmins('Pedido listo sin recoger', `El pedido ${folio} sigue esperando al cliente.`, 'pickup');
    }
  }
  if (!initialized) await marker.set({ initializedAt: now });
}

// Netlify consulta los cambios cada cinco minutos.
exports.handler = schedule('*/5 * * * *', async () => {
  try {
    await run();
  } catch (error) {
    console.error('Scheduled push failed', error);
    throw error;
  }
});
