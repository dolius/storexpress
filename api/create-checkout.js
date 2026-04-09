const fs = require('fs');
const path = require('path');
const Stripe = require('stripe');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return res.status(500).json({ error: 'Stripe is not configured on this deployment yet' });
  }

  const stripe = new Stripe(stripeKey);
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  if (!body.items || !Array.isArray(body.items) || !body.items.length) {
    return res.status(400).json({ error: 'No items provided' });
  }

  const productsPath = path.join(process.cwd(), 'products.json');
  const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
  const byId = Object.fromEntries(products.map(p => [p.id, p]));

  const line_items = [];
  for (const item of body.items) {
    const product = byId[item.id];
    if (!product || product.active === false) {
      return res.status(400).json({ error: `Unknown product: ${item.id}` });
    }
    const qty = Math.max(1, parseInt(item.qty || 1, 10));
    line_items.push({
      price_data: {
        currency: 'usd',
        unit_amount: Math.round(Number(product.price) * 100),
        product_data: { name: product.name }
      },
      quantity: qty
    });
  }

  try {
    const origin = req.headers.origin || 'https://storexpress-nine.vercel.app';
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: `${origin}/cart.html?success=1`,
      cancel_url: `${origin}/cart.html?canceled=1`
    });
    return res.status(200).json({ url: session.url });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Stripe checkout failed' });
  }
};
