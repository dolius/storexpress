import json
import os
import uuid
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory, abort
import stripe

app = Flask(__name__, static_folder=".", static_url_path="")

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
stripe.api_key = STRIPE_SECRET_KEY

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PRODUCTS_FILE = os.path.join(BASE_DIR, "products.json")
ORDERS_FILE   = os.path.join(BASE_DIR, "orders.json")
ADMIN_PASSWORD = "admin123"


def read_json(path):
    with open(path, "r") as f:
        return json.load(f)

def write_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


# ── Static pages ──────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")

@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(BASE_DIR, filename)


# ── Products ──────────────────────────────────────────────────────────────────

@app.route("/api/products", methods=["GET"])
def get_products():
    products = read_json(PRODUCTS_FILE)
    return jsonify([p for p in products if p.get("active")])

@app.route("/api/products/<product_id>", methods=["GET"])
def get_product(product_id):
    products = read_json(PRODUCTS_FILE)
    product = next((p for p in products if p["id"] == product_id), None)
    if not product or not product.get("active"):
        abort(404)
    return jsonify(product)


# ── Orders ────────────────────────────────────────────────────────────────────

@app.route("/api/order", methods=["POST"])
def create_order():
    body = request.get_json()
    if not body or not body.get("items"):
        return jsonify({"error": "No items provided"}), 400

    products = {p["id"]: p for p in read_json(PRODUCTS_FILE)}
    line_items = []
    total = 0

    for item in body["items"]:
        product = products.get(item["id"])
        if not product:
            return jsonify({"error": f"Unknown product: {item['id']}"}), 400
        qty = max(1, int(item.get("qty", 1)))
        line_items.append({
            "id": product["id"],
            "name": product["name"],
            "price": product["price"],
            "qty": qty,
            "subtotal": round(product["price"] * qty, 2)
        })
        total += product["price"] * qty

    order = {
        "id": str(uuid.uuid4()),
        "created_at": datetime.utcnow().isoformat(),
        "items": line_items,
        "total": round(total, 2),
        "email": body.get("email", ""),
        "status": "pending"
    }

    orders = read_json(ORDERS_FILE)
    orders.append(order)
    write_json(ORDERS_FILE, orders)

    return jsonify({"order_id": order["id"], "total": order["total"]}), 201


# ── Stripe Checkout ───────────────────────────────────────────────────────────

@app.route("/api/create-checkout", methods=["POST"])
def create_checkout():
    body = request.get_json()
    if not body or not body.get("items"):
        return jsonify({"error": "No items provided"}), 400

    products = {p["id"]: p for p in read_json(PRODUCTS_FILE)}
    line_items = []

    for item in body["items"]:
        product = products.get(item["id"])
        if not product:
            return jsonify({"error": f"Unknown product: {item['id']}"}), 400
        qty = max(1, int(item.get("qty", 1)))
        line_items.append({
            "price_data": {
                "currency": "usd",
                "unit_amount": int(product["price"] * 100),
                "product_data": {"name": product["name"]}
            },
            "quantity": qty
        })

    origin = request.headers.get("Origin", "http://localhost:5000")

    session = stripe.checkout.Session.create(
        payment_method_types=["card"],
        line_items=line_items,
        mode="payment",
        success_url=f"{origin}/cart.html?success=1",
        cancel_url=f"{origin}/cart.html?canceled=1"
    )

    return jsonify({"url": session.url})


# ── Admin ─────────────────────────────────────────────────────────────────────

def require_admin():
    password = request.headers.get("X-Admin-Password", "")
    if password != ADMIN_PASSWORD:
        abort(401)

@app.route("/api/admin/add", methods=["POST"])
def admin_add():
    require_admin()
    body = request.get_json()
    required = ["name", "price", "image", "description"]
    if not all(body.get(k) for k in required):
        return jsonify({"error": "Missing required fields"}), 400

    products = read_json(PRODUCTS_FILE)
    new_product = {
        "id": "prod_" + str(uuid.uuid4())[:8],
        "name": body["name"],
        "price": float(body["price"]),
        "image": body["image"],
        "description": body["description"],
        "active": True
    }
    products.append(new_product)
    write_json(PRODUCTS_FILE, products)
    return jsonify(new_product), 201

@app.route("/api/admin/update", methods=["POST"])
def admin_update():
    require_admin()
    body = request.get_json()
    if not body.get("id"):
        return jsonify({"error": "Missing product id"}), 400

    products = read_json(PRODUCTS_FILE)
    for i, p in enumerate(products):
        if p["id"] == body["id"]:
            updatable = ["name", "price", "image", "description", "active"]
            for key in updatable:
                if key in body:
                    products[i][key] = body[key]
            write_json(PRODUCTS_FILE, products)
            return jsonify(products[i])

    return jsonify({"error": "Product not found"}), 404

@app.route("/api/admin/products-all", methods=["GET"])
def admin_products_all():
    require_admin()
    return jsonify(read_json(PRODUCTS_FILE))

@app.route("/api/admin/orders", methods=["GET"])
def admin_orders():
    require_admin()
    return jsonify(read_json(ORDERS_FILE))


if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=True, port=8080)
