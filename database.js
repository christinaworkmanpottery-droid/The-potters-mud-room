const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'pottery.db');

function initDB() {
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    -- Users with profiles
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      bio TEXT,
      location TEXT,
      website TEXT,
      avatar_filename TEXT,
      is_private INTEGER DEFAULT 0,
      tier TEXT DEFAULT 'free' CHECK(tier IN ('free', 'basic', 'mid', 'top')),
      forum_tokens INTEGER DEFAULT 0,
      unlimited_tokens_until TEXT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      billing_period TEXT DEFAULT 'monthly' CHECK(billing_period IN ('monthly', 'yearly', 'promo')),
      plan_expires_at TEXT,
      referral_code TEXT UNIQUE,
      referred_by TEXT,
      unit_system TEXT DEFAULT 'imperial' CHECK(unit_system IN ('imperial', 'metric')),
      temp_unit TEXT DEFAULT 'fahrenheit' CHECK(temp_unit IN ('fahrenheit', 'celsius')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Blocked users
    CREATE TABLE IF NOT EXISTS blocked_users (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      blocked_user_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (blocked_user_id) REFERENCES users(id),
      UNIQUE(user_id, blocked_user_id)
    );

    -- Clay Bodies
    CREATE TABLE IF NOT EXISTS clay_bodies (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      brand TEXT,
      color_wet TEXT,
      color_fired TEXT,
      shrinkage_pct REAL,
      cone_range TEXT,
      clay_type TEXT CHECK(clay_type IN ('stoneware', 'porcelain', 'earthenware', 'terracotta', 'raku', 'other')),
      cost_per_bag REAL,
      bag_weight TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Glazes
    CREATE TABLE IF NOT EXISTS glazes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      glaze_type TEXT DEFAULT 'commercial' CHECK(glaze_type IN ('commercial', 'recipe')),
      brand TEXT,
      sku TEXT,
      color_description TEXT,
      cone_range TEXT,
      atmosphere TEXT CHECK(atmosphere IN ('oxidation', 'reduction', 'neutral', 'any', NULL)),
      surface TEXT CHECK(surface IN ('gloss', 'satin', 'matte', 'crystal', 'other', NULL)),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Glaze Photos (up to 3 for paying members)
    CREATE TABLE IF NOT EXISTS glaze_photos (
      id TEXT PRIMARY KEY,
      glaze_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (glaze_id) REFERENCES glazes(id) ON DELETE CASCADE
    );

    -- Glaze Recipe Ingredients
    CREATE TABLE IF NOT EXISTS glaze_ingredients (
      id TEXT PRIMARY KEY,
      glaze_id TEXT NOT NULL,
      ingredient_name TEXT NOT NULL,
      percentage REAL,
      amount TEXT,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (glaze_id) REFERENCES glazes(id) ON DELETE CASCADE
    );

    -- Pieces
    CREATE TABLE IF NOT EXISTS pieces (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT,
      description TEXT,
      clay_body_id TEXT,
      studio TEXT,
      status TEXT DEFAULT 'in-progress' CHECK(status IN ('in-progress', 'leather-hard', 'bone-dry', 'bisque-fired', 'glazed', 'glaze-fired', 'done', 'sold', 'broken', 'recycled')),
      form TEXT,
      technique TEXT CHECK(technique IN ('wheel-thrown', 'hand-built', 'slab', 'coil', 'pinch', 'slip-cast', 'other', NULL)),
      dimensions TEXT,
      weight TEXT,
      material_cost REAL,
      firing_cost REAL,
      sale_price REAL,
      date_started TEXT,
      date_completed TEXT,
      date_sold TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (clay_body_id) REFERENCES clay_bodies(id) ON DELETE SET NULL
    );

    -- Piece Photos (up to 3 for paying, 1 for free)
    CREATE TABLE IF NOT EXISTS piece_photos (
      id TEXT PRIMARY KEY,
      piece_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT,
      stage TEXT CHECK(stage IN ('wet', 'leather-hard', 'bone-dry', 'bisque', 'glazed', 'finished', 'detail', 'other')),
      is_primary INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE CASCADE
    );

    -- Piece-Glaze relationship
    CREATE TABLE IF NOT EXISTS piece_glazes (
      id TEXT PRIMARY KEY,
      piece_id TEXT NOT NULL,
      glaze_id TEXT NOT NULL,
      coats INTEGER DEFAULT 1,
      application_method TEXT CHECK(application_method IN ('dip', 'brush', 'spray', 'pour', 'wax-resist', 'other', NULL)),
      layer_order INTEGER DEFAULT 0,
      notes TEXT,
      FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE CASCADE,
      FOREIGN KEY (glaze_id) REFERENCES glazes(id) ON DELETE CASCADE
    );

    -- Firing Logs
    CREATE TABLE IF NOT EXISTS firing_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      piece_id TEXT,
      firing_type TEXT CHECK(firing_type IN ('bisque', 'glaze', 'raku', 'pit', 'wood', 'other')),
      cone TEXT,
      temperature TEXT,
      atmosphere TEXT CHECK(atmosphere IN ('oxidation', 'reduction', 'neutral', NULL)),
      kiln_name TEXT,
      schedule TEXT,
      duration TEXT,
      firing_speed TEXT CHECK(firing_speed IN ('slow', 'medium', 'fast', 'custom', NULL)),
      hold_used INTEGER DEFAULT 0,
      hold_duration TEXT,
      date TEXT,
      results TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE SET NULL
    );

    -- Sales
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      piece_id TEXT,
      date TEXT,
      price REAL,
      venue TEXT,
      venue_type TEXT CHECK(venue_type IN ('online', 'art-fair', 'gallery', 'studio', 'commission', 'gift', 'other', NULL)),
      buyer_name TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE SET NULL
    );

    -- Community Glaze Combos
    CREATE TABLE IF NOT EXISTS glaze_combos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      clay_body_name TEXT,
      cone TEXT,
      atmosphere TEXT,
      is_shared INTEGER DEFAULT 0,
      description TEXT,
      photo_filename TEXT,
      likes INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Glaze Combo Layers
    CREATE TABLE IF NOT EXISTS glaze_combo_layers (
      id TEXT PRIMARY KEY,
      combo_id TEXT NOT NULL,
      glaze_name TEXT NOT NULL,
      brand TEXT,
      coats INTEGER DEFAULT 1,
      application_method TEXT,
      layer_order INTEGER DEFAULT 0,
      FOREIGN KEY (combo_id) REFERENCES glaze_combos(id) ON DELETE CASCADE
    );

    -- Forum Categories
    CREATE TABLE IF NOT EXISTS forum_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      icon TEXT
    );

    -- Forum Posts
    CREATE TABLE IF NOT EXISTS forum_posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category_id TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      is_pinned INTEGER DEFAULT 0,
      reply_count INTEGER DEFAULT 0,
      view_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (category_id) REFERENCES forum_categories(id)
    );

    -- Forum Replies
    CREATE TABLE IF NOT EXISTS forum_replies (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Forum Post Photos
    CREATE TABLE IF NOT EXISTS forum_photos (
      id TEXT PRIMARY KEY,
      post_id TEXT,
      reply_id TEXT,
      filename TEXT NOT NULL,
      original_name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (reply_id) REFERENCES forum_replies(id) ON DELETE CASCADE
    );

    -- Token Purchase History
    CREATE TABLE IF NOT EXISTS token_purchases (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      price_paid REAL,
      purchase_type TEXT CHECK(purchase_type IN ('pack', 'unlimited_30day')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Merchant Products (Christina's shop)
    CREATE TABLE IF NOT EXISTS merchant_products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      product_type TEXT CHECK(product_type IN ('sticker', 'journal', 'pdf', 'other')),
      image_filename TEXT,
      download_filename TEXT,
      is_digital INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Promo Codes
    CREATE TABLE IF NOT EXISTS promo_codes (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      tier TEXT NOT NULL CHECK(tier IN ('basic', 'mid', 'top')),
      duration_days INTEGER DEFAULT 30,
      max_uses INTEGER DEFAULT 1,
      times_used INTEGER DEFAULT 0,
      created_by TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT
    );

    -- Promo Redemptions
    CREATE TABLE IF NOT EXISTS promo_redemptions (
      id TEXT PRIMARY KEY,
      promo_code_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      redeemed_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT,
      FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(promo_code_id, user_id)
    );

    -- Referral Rewards
    CREATE TABLE IF NOT EXISTS referral_rewards (
      id TEXT PRIMARY KEY,
      referrer_id TEXT NOT NULL,
      referred_id TEXT NOT NULL,
      tokens_awarded INTEGER DEFAULT 5,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (referrer_id) REFERENCES users(id),
      FOREIGN KEY (referred_id) REFERENCES users(id)
    );

    -- Merchant Orders
    CREATE TABLE IF NOT EXISTS merchant_orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      product_id TEXT,
      price_paid REAL,
      status TEXT DEFAULT 'completed',
      stripe_session_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (product_id) REFERENCES merchant_products(id)
    );

    -- Insert default forum categories
    INSERT OR IGNORE INTO forum_categories (id, name, description, sort_order, icon) VALUES
      ('cat-general', 'General Chat', 'Talk about anything pottery related', 1, '💬'),
      ('cat-glazes', 'Glazes & Combos', 'Share glaze results, combos, and recipes', 2, '🎨'),
      ('cat-clay', 'Clay Bodies', 'Discuss different clays and their properties', 3, '🪨'),
      ('cat-firing', 'Firing & Kilns', 'Firing schedules, kiln tips, and results', 4, '🔥'),
      ('cat-techniques', 'Techniques', 'Hand building, throwing, trimming, and more', 5, '🏺'),
      ('cat-selling', 'Selling & Business', 'Pricing, shows, online sales, and business tips', 6, '💰'),
      ('cat-beginners', 'Beginners Welcome', 'No question is too basic — we all started somewhere', 7, '🌱'),
      ('cat-show-off', 'Show Your Work', 'Share photos of your pieces — we wanna see!', 8, '📸'),
      ('cat-casualties', 'Pottery Casualties', 'RIP to the pieces that didn''t make it. Cracks, explosions, glaze disasters — share your pottery fails!', 9, '💀');

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_pieces_user ON pieces(user_id);
    CREATE INDEX IF NOT EXISTS idx_pieces_status ON pieces(status);
    CREATE INDEX IF NOT EXISTS idx_pieces_clay ON pieces(clay_body_id);
    CREATE INDEX IF NOT EXISTS idx_clay_user ON clay_bodies(user_id);
    CREATE INDEX IF NOT EXISTS idx_glazes_user ON glazes(user_id);
    CREATE INDEX IF NOT EXISTS idx_photos_piece ON piece_photos(piece_id);
    CREATE INDEX IF NOT EXISTS idx_piece_glazes_piece ON piece_glazes(piece_id);
    CREATE INDEX IF NOT EXISTS idx_firing_user ON firing_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_sales_user ON sales(user_id);
    CREATE INDEX IF NOT EXISTS idx_combos_shared ON glaze_combos(is_shared);
    CREATE INDEX IF NOT EXISTS idx_forum_posts_cat ON forum_posts(category_id);
    CREATE INDEX IF NOT EXISTS idx_forum_posts_user ON forum_posts(user_id);
    CREATE INDEX IF NOT EXISTS idx_forum_replies_post ON forum_replies(post_id);
    CREATE INDEX IF NOT EXISTS idx_blocked_user ON blocked_users(user_id);
    CREATE INDEX IF NOT EXISTS idx_glaze_photos ON glaze_photos(glaze_id);
  `);

  return db;
}

module.exports = { initDB, DB_PATH };
