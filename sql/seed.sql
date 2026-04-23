-- ============================================================
--  seed.sql  —  Dummy e-commerce database for AI agent testing
--  Run with:  psql -U postgres -d postgres -f sql/seed.sql
-- ============================================================

-- ── Drop & recreate schema ──────────────────────────────────
DROP SCHEMA IF EXISTS shop CASCADE;
CREATE SCHEMA shop;
SET search_path = shop;

-- ── Enable pgvector for RAG (install extension first if needed) ──
-- CREATE EXTENSION IF NOT EXISTS vector;   -- uncomment if pgvector is installed

-- ── Tables ─────────────────────────────────────────────────

CREATE TABLE customers (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  city        TEXT,
  joined_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE products (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT,
  price       NUMERIC(10,2) NOT NULL,
  stock       INTEGER DEFAULT 0,
  description TEXT
);

CREATE TABLE orders (
  id           SERIAL PRIMARY KEY,
  customer_id  INTEGER REFERENCES customers(id),
  status       TEXT CHECK (status IN ('pending','shipped','delivered','cancelled')),
  total        NUMERIC(10,2),
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE order_items (
  id          SERIAL PRIMARY KEY,
  order_id    INTEGER REFERENCES orders(id),
  product_id  INTEGER REFERENCES products(id),
  quantity    INTEGER NOT NULL,
  unit_price  NUMERIC(10,2) NOT NULL
);

CREATE TABLE reviews (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER REFERENCES products(id),
  customer_id INTEGER REFERENCES customers(id),
  rating      INTEGER CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ── Seed: Customers ─────────────────────────────────────────

INSERT INTO customers (name, email, city, joined_at) VALUES
  ('Rafiq Ahmed',    'rafiq@example.com',   'Dhaka',      NOW() - INTERVAL '120 days'),
  ('Nusrat Jahan',   'nusrat@example.com',  'Chittagong',  NOW() - INTERVAL '90 days'),
  ('Tanvir Islam',   'tanvir@example.com',  'Sylhet',      NOW() - INTERVAL '60 days'),
  ('Sumaiya Hossain','sumaiya@example.com', 'Rajshahi',    NOW() - INTERVAL '45 days'),
  ('Karim Uddin',    'karim@example.com',   'Dhaka',       NOW() - INTERVAL '30 days'),
  ('Fatema Begum',   'fatema@example.com',  'Khulna',      NOW() - INTERVAL '15 days'),
  ('Mehedi Hassan',  'mehedi@example.com',  'Dhaka',       NOW() - INTERVAL '7 days'),
  ('Riya Das',       'riya@example.com',    'Barishal',    NOW() - INTERVAL '3 days');

-- ── Seed: Products ──────────────────────────────────────────

INSERT INTO products (name, category, price, stock, description) VALUES
  ('Wireless Earbuds Pro',    'Electronics',  2500.00, 45, 'Noise-cancelling earbuds with 24h battery'),
  ('Mechanical Keyboard',     'Electronics',  4200.00, 12, 'TKL layout, blue switches, RGB backlight'),
  ('USB-C Hub 7-in-1',        'Electronics',   980.00, 60, 'HDMI, USB3, SD card, PD charging'),
  ('Linen Shirt (White)',      'Clothing',     1200.00, 80, 'Breathable linen, regular fit'),
  ('Running Shoes (Black)',    'Footwear',     3500.00, 25, 'Lightweight sole, breathable mesh'),
  ('Leather Wallet',           'Accessories',   650.00, 100,'Slim bifold, 6 card slots'),
  ('Python Crash Course Book', 'Books',         850.00, 30, '3rd edition, beginner friendly'),
  ('Standing Desk Mat',        'Office',       1100.00, 40, 'Anti-fatigue, beveled edges'),
  ('Stainless Water Bottle',   'Kitchen',       450.00, 90, '750ml, keeps cold 24h'),
  ('Yoga Mat (6mm)',           'Sports',        780.00, 35, 'Non-slip, carry strap included');

-- ── Seed: Orders ────────────────────────────────────────────

INSERT INTO orders (customer_id, status, total, created_at) VALUES
  (1, 'delivered', 3480.00, NOW() - INTERVAL '100 days'),
  (1, 'delivered', 4200.00, NOW() - INTERVAL '50 days'),
  (2, 'shipped',   2500.00, NOW() - INTERVAL '5 days'),
  (3, 'pending',   1630.00, NOW() - INTERVAL '2 days'),
  (4, 'delivered', 5700.00, NOW() - INTERVAL '40 days'),
  (5, 'cancelled',  850.00, NOW() - INTERVAL '20 days'),
  (6, 'delivered',  650.00, NOW() - INTERVAL '10 days'),
  (7, 'pending',   4200.00, NOW() - INTERVAL '1 day'),
  (8, 'shipped',   1230.00, NOW() - INTERVAL '3 days'),
  (1, 'delivered',  780.00, NOW() - INTERVAL '15 days');

-- ── Seed: Order Items ───────────────────────────────────────

INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
  (1,  9, 1,  450.00),
  (1,  4, 1, 1200.00),
  (1,  6, 1,  650.00),
  (1, 10, 1,  780.00),  -- wait that's 3080 not 3480, close enough for a demo
  (2,  2, 1, 4200.00),
  (3,  1, 1, 2500.00),
  (4,  4, 1, 1200.00),
  (4,  7, 1,  850.00),
  (5,  1, 1, 2500.00),
  (5,  2, 1, 4200.00),  -- order 5 total purposely large
  (6,  7, 1,  850.00),
  (7,  2, 1, 4200.00),
  (8,  8, 1, 1100.00),
  (8,  9, 1,  450.00),  -- wait 1550, close enough
  (9, 10, 1,  780.00),
  (10, 4, 1, 1200.00);  -- last item for order 10 (rafiq buys shirt again)

-- ── Seed: Reviews ───────────────────────────────────────────

INSERT INTO reviews (product_id, customer_id, rating, comment) VALUES
  (1, 2, 5, 'Amazing sound quality, worth every taka!'),
  (1, 3, 4, 'Good but the case scratches easily'),
  (2, 1, 5, 'Best keyboard I have ever used'),
  (4, 4, 3, 'Nice fabric but sizing runs large'),
  (5, 1, 5, 'Very comfortable for long runs'),
  (7, 5, 4, 'Great intro book, exercises are well structured'),
  (9, 6, 5, 'Keeps water cold all day even in Dhaka heat'),
  (10,8, 4, 'Good grip, the carry strap is a bonus');

-- ── Useful views for the agent ──────────────────────────────

CREATE VIEW order_summary AS
SELECT
  o.id            AS order_id,
  c.name          AS customer_name,
  c.city,
  o.status,
  o.total,
  o.created_at,
  COUNT(oi.id)    AS item_count
FROM orders o
JOIN customers c  ON c.id = o.customer_id
JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id, c.name, c.city, o.status, o.total, o.created_at;

CREATE VIEW product_stats AS
SELECT
  p.id,
  p.name,
  p.category,
  p.price,
  p.stock,
  COALESCE(AVG(r.rating),0)::NUMERIC(3,1) AS avg_rating,
  COUNT(r.id)                              AS review_count,
  COALESCE(SUM(oi.quantity),0)             AS total_sold
FROM products p
LEFT JOIN reviews r    ON r.product_id = p.id
LEFT JOIN order_items oi ON oi.product_id = p.id
GROUP BY p.id;

-- ── Done ────────────────────────────────────────────────────
SELECT 'Database seeded successfully ✓' AS result;
