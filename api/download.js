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
    const sessionId = req.query?.session_id;
    const productId = req.query?.product_id;

    if (!stripeKey) return res.status(500).json({ error: 'Stripe is not configured' });
    if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_live_')) {
      return res.status(400).json({ error: 'A valid paid session is required' });
    }
    if (!productId || typeof productId !== 'string') {
      return res.status(400).json({ error: 'Product is required' });
    }

    const session = await stripeRequest(stripeKey, `checkout/sessions/${encodeURIComponent(sessionId)}`);
    if (session.payment_status !== 'paid' || session.status !== 'complete') {
      return res.status(402).json({ error: 'Payment is not complete yet' });
    }

    const purchasedIds = String(session.metadata?.product_ids || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);
    if (!purchasedIds.includes(productId)) {
      return res.status(403).json({ error: 'This product was not included in the paid order' });
    }

    const productsPath = path.join(process.cwd(), 'products.json');
    const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
    const product = products.find(item => item.id === productId && item.download);
    if (!product) return res.status(404).json({ error: 'Download not found' });

    const filePath = path.join(process.cwd(), product.download.replace(/^\/+/, ''));
    if (!filePath.startsWith(process.cwd()) || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to download file' });
  }
};
