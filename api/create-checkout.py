import json
import os
from pathlib import Path

import stripe

PRODUCTS_FILE = Path(__file__).resolve().parent.parent / 'products.json'
STRIPE_SECRET_KEY = os.environ.get('STRIPE_SECRET_KEY')
stripe.api_key = STRIPE_SECRET_KEY if STRIPE_SECRET_KEY else ''


def load_products():
    with PRODUCTS_FILE.open() as f:
        return {p['id']: p for p in json.load(f)}


def handler(request):
    if request.method != 'POST':
        return {
            'statusCode': 405,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Method not allowed'})
        }

    try:
        body = request.get_json() if hasattr(request, 'get_json') else json.loads(request.body)
    except Exception:
        body = None

    if not body or not body.get('items'):
        return {
            'statusCode': 400,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'No items provided'})
        }

    if not STRIPE_SECRET_KEY:
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Stripe is not configured on this deployment yet'})
        }

    products = load_products()
    line_items = []

    for item in body['items']:
        product = products.get(item.get('id'))
        if not product or product.get('active') is False:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'error': f"Unknown product: {item.get('id')}"})
            }
        qty = max(1, int(item.get('qty', 1)))
        line_items.append({
            'price_data': {
                'currency': 'usd',
                'unit_amount': int(float(product['price']) * 100),
                'product_data': {'name': product['name']}
            },
            'quantity': qty
        })

    origin = request.headers.get('origin') or request.headers.get('Origin') or 'https://storexpress.vercel.app'

    try:
        session = stripe.checkout.Session.create(
            payment_method_types=['card'],
            line_items=line_items,
            mode='payment',
            success_url=f'{origin}/cart.html?success=1',
            cancel_url=f'{origin}/cart.html?canceled=1'
        )
    except Exception as e:
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': str(e)})
        }

    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps({'url': session.url})
    }
