const fs = require('fs');
const path = require('path');

async function createStripeCheckout(stripeKey, origin, items) {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `${origin}/cart.html?success=1`);
  params.set('cancel_url', `${origin}/cart.html?canceled=1`);
  params.append('payment_method_types[]', 'card');

  items.forEach((item, index) => {
    params.set(`line_items[${index}][price_data][currency]`, 'usd');
    params.set(`line_items[${index}][price_data][unit_amount]`, String(Math.round(Number(item.price) * 100)));
    params.set(`line_items[${index}][price_data][product_data][name]`, item.name);
    params.set(`line_items[${index}][quantity]`, String(item.qty));
  });

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Stripe checkout failed');
  }
  return data;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return res.status(500).json({ error: 'Stripe is not configured on this deployment yet' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (!body.items || !Array.isArray(body.items) || !body.items.length) {
      return res.status(400).json({ error: 'No items provided' });
    }

    const productsPath = path.join(process.cwd(), 'products.json');
    const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
    const byId = Object.fromEntries(products.map(p => [p.id, p]));

    const normalizedItems = [];
    for (const item of body.items) {
      const product = byId[item.id];
      if (!product || product.active === false) {
        return res.status(400).json({ error: `Unknown product: ${item.id}` });
      }
      normalizedItems.push({
        name: product.name,
        price: Number(product.price),
        qty: Math.max(1, parseInt(item.qty || 1, 10))
      });
    }

    const origin = req.headers.origin || 'https://storexpress-nine.vercel.app';
    const session = await createStripeCheckout(stripeKey, origin, normalizedItems);
    return res.status(200).json({ url: session.url });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Stripe checkout failed' });
  }
};
