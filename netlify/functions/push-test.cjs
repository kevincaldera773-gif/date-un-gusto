
'use strict';

const { auth, send } = require('./_push-core.cjs');

const ALLOWED_ORIGINS = [
  'https://dateungusto.com.mx',
  'https://www.dateungusto.com.mx',
  'https://cosmic-semifreddo-d3c3c5.netlify.app'
];

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || '';

  const allowed = ALLOWED_ORIGINS.includes(origin);

  const headers = {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json'
  };

  if (origin && !allowed) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'Origen no permitido' })
    };
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: '{}' };
  }

  try {
    const bearer =
      event.headers?.authorization ||
      event.headers?.Authorization ||
      '';

    if (!bearer.startsWith('Bearer ')) {
      return { statusCode: 401, headers, body: '{}' };
    }

    const user = await auth().verifyIdToken(bearer.slice(7), true);

    const sent = await send(user.uid, {
      title: 'Date un Gusto 🔔',
      body: '¡Tu notificación de prueba llegó correctamente!',
      tag: 'dug-test',
      screen: 'orders'
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ sent })
    };
  } catch (e) {
    console.error('test push', e.message);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'No se pudo enviar la prueba'
      })
    };
  }
};
