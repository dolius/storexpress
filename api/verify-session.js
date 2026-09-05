const fs = require('fs');
const path = require('path');

async function stripeRequest(stripeKey, endpoint) {
  const response = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    headers: { Authorization: `Bearer ${stripeKey}` }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Stripe verification failed');
  }
  return data;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return res.status(500).json({ error: 'Stripe is not configured on this deployment yet' });
    }

    const sessionId = req.query?.session_id;
    if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_live_')) {
      return res.status(400).json({ error: 'A valid live checkout session is required' });
    }

    const session = await stripeRequest(stripeKey, `checkout/sessions/${encodeURIComponent(sessionId)}`);
    if (session.payment_status !== 'paid' || session.status !== 'complete') {
      return res.status(402).json({ error: 'Payment is not complete yet' });
    }

    const productsPath = path.join(process.cwd(), 'products.json');
    const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
    const byId = Object.fromEntries(products.map(product => [product.id, product]));
    const ids = String(session.metadata?.product_ids || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);

    const downloads = ids
      .map(id => byId[id])
      .filter(product => product && product.download)
      .map(product => ({
        id: product.id,
        name: product.name,
        url: `/api/download?product_id=${encodeURIComponent(product.id)}`
      }));

    return res.status(200).json({
      id: session.id,
      amount_total: session.amount_total,
      currency: session.currency,
      customer_email: session.customer_details?.email || session.customer_email || null,
      created: session.created,
      downloads
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to verify checkout session' });
  }
};
