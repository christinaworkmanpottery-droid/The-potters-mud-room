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
      tier TEXT DEFAULT 'free' CHECK(tier IN ('free', 'basic', 'mid', 'top', 'starter')),
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
      newsletter_subscribed INTEGER DEFAULT 1,
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
      firing_type TEXT CHECK(firing_type IN ('bisque', 'glaze', 'lustre', 'raku', 'pit', 'wood', 'soda', 'salt', 'maintenance', 'element-change', 'thermocouple', 'preheat', 'soak', 'other')),
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
      venue_type TEXT CHECK(venue_type IN ('online', 'art-fair', 'gallery', 'studio', 'commission', 'gift', 'website', 'other', NULL)),
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
      promo_type TEXT DEFAULT 'tier' CHECK(promo_type IN ('tier', 'tokens')),
      tier TEXT CHECK(tier IN ('basic', 'mid', 'top')),
      token_amount INTEGER DEFAULT 0,
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

    -- Shop discount codes
    CREATE TABLE IF NOT EXISTS discount_codes (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      discount_pct REAL NOT NULL DEFAULT 10,
      max_uses INTEGER DEFAULT 0,
      times_used INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT
    );

    -- Page view analytics
    CREATE TABLE IF NOT EXISTS page_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      referrer TEXT,
      user_agent TEXT,
      ip TEXT,
      user_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_page_views_date ON page_views(created_at);
    CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views(path);

    -- User activity tracking (feature usage)
    CREATE TABLE IF NOT EXISTS user_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      page TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_activity_user ON user_activity(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_activity_action ON user_activity(action);
    CREATE INDEX IF NOT EXISTS idx_user_activity_date ON user_activity(created_at);

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
      ('cat-casualties', 'Pottery Casualties', 'RIP to the pieces that didn''t make it. Cracks, explosions, glaze disasters — share your pottery fails!', 9, '💀'),
      ('cat-help', 'Mud Room Help', 'Questions about using The Potter''s Mud Room? Ask here and we''ll help!', 10, '❓'),
      ('cat-events', 'Events', 'Post pottery events, workshops, shows, and meetups near you!', 11, '📅'),
      ('cat-jobs', 'Job Board', 'Pottery jobs, studio assistant positions, teaching gigs, and opportunities', 12, '💼');

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

  // Safe column additions for existing DBs
  const safeAdd = (table, col, type) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch(e) { /* column already exists */ }
  };
  safeAdd('promo_codes', 'token_amount', 'INTEGER DEFAULT 0');
  safeAdd('promo_codes', 'promo_type', "TEXT DEFAULT 'tier'");
  safeAdd('users', 'profile_photo', 'TEXT');
  safeAdd('users', 'username', 'TEXT');
  safeAdd('users', 'billing_period', "TEXT DEFAULT 'monthly'");
  safeAdd('users', 'plan_expires_at', 'TEXT');
  safeAdd('firing_logs', 'custom_speed_detail', 'TEXT');
  safeAdd('glaze_combos', 'photo_filename2', 'TEXT');
  // Casualty tracking fields
  safeAdd('pieces', 'casualty_type', 'TEXT');
  safeAdd('pieces', 'casualty_notes', 'TEXT');
  safeAdd('pieces', 'casualty_lesson', 'TEXT');

  // Part 1 revamp — new fields for clays
  safeAdd('clay_bodies', 'absorption_pct', 'REAL');
  safeAdd('clay_bodies', 'source', 'TEXT');
  safeAdd('clay_bodies', 'source_url', 'TEXT');
  safeAdd('clay_bodies', 'in_stock', 'INTEGER DEFAULT 1');
  safeAdd('clay_bodies', 'buy_url', 'TEXT');

  // Firing log improvements (items 18-25)
  safeAdd('firing_logs', 'firing_time', 'TEXT');
  safeAdd('firing_logs', 'firing_mode', "TEXT DEFAULT 'kiln-load'");
  safeAdd('firing_logs', 'load_description', 'TEXT');
  safeAdd('firing_logs', 'firing_mode_notes', 'TEXT');

  // Firing log time/temp tracking (start, end, open temp)
  safeAdd('firing_logs', 'start_time', 'TEXT');
  safeAdd('firing_logs', 'end_time', 'TEXT');
  safeAdd('firing_logs', 'open_temp', 'TEXT');

  // Firing photos table
  db.exec(`
    CREATE TABLE IF NOT EXISTS firing_photos (
      id TEXT PRIMARY KEY,
      firing_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (firing_id) REFERENCES firing_logs(id) ON DELETE CASCADE
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_firing_photos ON firing_photos(firing_id)`);

  // Project photos table
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_photos (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_project_photos ON project_photos(project_id)`);

  // Sales improvements (items 26-28)
  safeAdd('sales', 'quantity', 'INTEGER DEFAULT 1');
  safeAdd('sales', 'item_description', 'TEXT');
  safeAdd('sales', 'event_name', 'TEXT');
  safeAdd('sales', 'buyer_email', 'TEXT');
  safeAdd('sales', 'buyer_phone', 'TEXT');
  safeAdd('sales', 'image_filename', 'TEXT');

  // Contact linking (items 29-31)
  safeAdd('contacts', 'role', 'TEXT'); // buyer, gallery, potter, venue, supplier, other
  safeAdd('contacts', 'address', 'TEXT');
  safeAdd('contacts', 'instagram', 'TEXT');
  safeAdd('contacts', 'website', 'TEXT');
  safeAdd('sales', 'contact_id', 'TEXT');
  safeAdd('events', 'contact_id', 'TEXT');

  // Remove venue_type CHECK constraint (allow 'website' and future values)
  try {
    const hasOldCheck = db.prepare("SELECT sql FROM sqlite_master WHERE name='sales'").get();
    if (hasOldCheck && hasOldCheck.sql && hasOldCheck.sql.includes("CHECK(venue_type IN")) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sales_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          piece_id TEXT,
          date TEXT,
          price REAL,
          venue TEXT,
          venue_type TEXT,
          buyer_name TEXT,
          notes TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          quantity INTEGER DEFAULT 1,
          item_description TEXT,
          event_name TEXT,
          buyer_email TEXT,
          buyer_phone TEXT,
          image_filename TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE SET NULL
        );
        INSERT INTO sales_new SELECT id,user_id,piece_id,date,price,venue,venue_type,buyer_name,notes,created_at,quantity,item_description,event_name,buyer_email,buyer_phone,image_filename FROM sales;
        DROP TABLE sales;
        ALTER TABLE sales_new RENAME TO sales;
        CREATE INDEX IF NOT EXISTS idx_sales_user ON sales(user_id);
      `);
    }
  } catch(e) { /* migration already done or no data */ }

  // Goals table (item 36)
  db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'archived')),
      due_date TEXT,
      priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id)`);

  // Projects table (item 37)
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'archived')),
      due_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)`);

  // Admin docs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_docs (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      pinned INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Events table (item 39)
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      event_date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      location TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date)`);
  safeAdd('events', 'image_filename', 'TEXT');

  // Contacts table (item 40)
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id)`);

  // Part 1 revamp — new fields for glazes
  safeAdd('glazes', 'opacity', 'TEXT');
  safeAdd('glazes', 'recipe_status', 'TEXT');
  safeAdd('glazes', 'recipe_notes', 'TEXT');
  safeAdd('glazes', 'stock_status', 'TEXT');
  safeAdd('glazes', 'source', 'TEXT');
  safeAdd('glazes', 'source_url', 'TEXT');
  safeAdd('glazes', 'in_stock', 'INTEGER DEFAULT 1');
  safeAdd('glazes', 'buy_url', 'TEXT');

  // Part 1 revamp — photo labels/notes for glaze_photos
  safeAdd('glaze_photos', 'photo_label', 'TEXT');
  safeAdd('glaze_photos', 'notes', 'TEXT');

  // Part 1 revamp — clay photos table
  db.exec(`
    CREATE TABLE IF NOT EXISTS clay_photos (
      id TEXT PRIMARY KEY,
      clay_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT,
      photo_label TEXT,
      notes TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (clay_id) REFERENCES clay_bodies(id) ON DELETE CASCADE
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_clay_photos ON clay_photos(clay_id)`);

  // Add updated_at to forum_replies (missing from original schema)
  safeAdd('forum_replies', 'updated_at', "TEXT DEFAULT NULL");

  // Part 1 revamp — glaze chemical inventory
  db.exec(`
    CREATE TABLE IF NOT EXISTS glaze_chemicals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      quantity REAL,
      unit TEXT DEFAULT 'oz',
      source TEXT,
      source_url TEXT,
      in_stock INTEGER DEFAULT 1,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chemicals_user ON glaze_chemicals(user_id)`);

  // Combo likes (user-specific, prevents double-liking)
  db.exec(`
    CREATE TABLE IF NOT EXISTS combo_likes (
      id TEXT PRIMARY KEY,
      combo_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (combo_id) REFERENCES glaze_combos(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(combo_id, user_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_combo_likes ON combo_likes(combo_id)`);

  // Combo comments
  db.exec(`
    CREATE TABLE IF NOT EXISTS combo_comments (
      id TEXT PRIMARY KEY,
      combo_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (combo_id) REFERENCES glaze_combos(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_combo_comments ON combo_comments(combo_id)`);

  // In-app notifications
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT,
      is_read INTEGER DEFAULT 0,
      from_user_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read)`);

  // In-app messages
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL,
      to_user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (from_user_id) REFERENCES users(id),
      FOREIGN KEY (to_user_id) REFERENCES users(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_user_id, is_read)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(from_user_id, to_user_id)`);

  // Ensure new forum categories exist
  const catInsert = db.prepare('INSERT OR IGNORE INTO forum_categories (id, name, description, sort_order, icon) VALUES (?,?,?,?,?)');
  catInsert.run('cat-events', 'Events', 'Post pottery events, workshops, shows, and meetups near you!', 11, '📅');
  catInsert.run('cat-jobs', 'Job Board', 'Pottery jobs, studio assistant positions, teaching gigs, and opportunities', 12, '💼');
  catInsert.run('cat-gear', 'Gear & Materials', 'Recommend your favorite tools, brushes, wheels, kilns, and pottery supplies!', 13, '🛠️');

  // Reviews table
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      body TEXT NOT NULL,
      is_approved INTEGER DEFAULT 0,
      is_featured INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Blog posts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS blog_posts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      excerpt TEXT,
      author TEXT DEFAULT 'Christina Workman',
      published_at TEXT DEFAULT (datetime('now')),
      is_published INTEGER DEFAULT 0,
      view_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_blog_slug ON blog_posts(slug)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_blog_published ON blog_posts(is_published, published_at)`);

  // Newsletter sends table
  db.exec(`
    CREATE TABLE IF NOT EXISTS newsletter_sends (
      id TEXT PRIMARY KEY,
      blog_post_id TEXT NOT NULL,
      sent_at TEXT DEFAULT (datetime('now')),
      sent_by TEXT NOT NULL,
      recipients_count INTEGER DEFAULT 0,
      FOREIGN KEY (blog_post_id) REFERENCES blog_posts(id),
      FOREIGN KEY (sent_by) REFERENCES users(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_newsletter_sends_post ON newsletter_sends(blog_post_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_newsletter_sends_date ON newsletter_sends(sent_at DESC)`);

  // Newsletter tracking (opens and clicks)
  db.exec(`
    CREATE TABLE IF NOT EXISTS newsletter_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      send_id TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      event_type TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (send_id) REFERENCES newsletter_sends(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_newsletter_tracking_send ON newsletter_tracking(send_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_newsletter_tracking_type ON newsletter_tracking(event_type)`);

  // Featured potter table
  db.exec(`
    CREATE TABLE IF NOT EXISTS featured_potter (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      quote TEXT,
      featured_date TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Newsletter subscribers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      subscribed_at TEXT DEFAULT (datetime('now')),
      is_active INTEGER DEFAULT 1
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_newsletter_email ON newsletter_subscribers(email)`);

  // Referral rewards table
  db.exec(`
    CREATE TABLE IF NOT EXISTS referral_rewards (
      id TEXT PRIMARY KEY,
      referrer_id TEXT NOT NULL,
      referred_id TEXT NOT NULL,
      tokens_awarded INTEGER DEFAULT 5,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (referrer_id) REFERENCES users(id),
      FOREIGN KEY (referred_id) REFERENCES users(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_referral_referrer ON referral_rewards(referrer_id)`);

  // Shareable combo columns
  safeAdd('glaze_combos', 'share_id', 'TEXT');
  safeAdd('glaze_combos', 'is_public', 'INTEGER DEFAULT 0');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_combos_share_id ON glaze_combos(share_id)`);

  // Referral code on users (may already exist from CREATE TABLE, but safe to add)
  safeAdd('users', 'referral_code', 'TEXT');
  safeAdd('users', 'referred_by', 'TEXT');
  safeAdd('users', 'free_months_remaining', 'INTEGER DEFAULT 0');
  safeAdd('users', 'newsletter_subscribed', 'INTEGER DEFAULT 1');
  safeAdd('referral_rewards', 'reward_type', "TEXT DEFAULT 'free_month'");

  // Studio Notes — freeform notes for Studio section
  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_studio_notes_user ON studio_notes(user_id)`);

  // Glaze clay body tests — track how glazes perform on different clay bodies
  db.exec(`
    CREATE TABLE IF NOT EXISTS glaze_clay_tests (
      id TEXT PRIMARY KEY,
      glaze_id TEXT NOT NULL,
      clay_body_id TEXT,
      clay_name TEXT NOT NULL,
      result_notes TEXT,
      photo_filename TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (glaze_id) REFERENCES glazes(id) ON DELETE CASCADE,
      FOREIGN KEY (clay_body_id) REFERENCES clay_bodies(id) ON DELETE SET NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_glaze_clay_tests_glaze ON glaze_clay_tests(glaze_id)`);

  // Site settings (for SMTP credentials etc.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Unified email sends history (newsletters + announcements)
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS email_sends (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'newsletter',
      subject TEXT,
      sent_at TEXT DEFAULT (datetime('now')),
      sent_by TEXT,
      recipients_count INTEGER DEFAULT 0,
      blog_post_id TEXT,
      FOREIGN KEY (sent_by) REFERENCES users(id),
      FOREIGN KEY (blog_post_id) REFERENCES blog_posts(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_email_sends_date ON email_sends(sent_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_email_sends_type ON email_sends(type)`);

  // Backfill: migrate existing newsletter_sends into email_sends
  try {
    const existing = db.prepare('SELECT COUNT(*) as c FROM email_sends WHERE type="newsletter"').get();
    if (existing.c === 0) {
      const nsSends = db.prepare('SELECT ns.id, ns.sent_at, ns.sent_by, ns.recipients_count, ns.blog_post_id, bp.title FROM newsletter_sends ns LEFT JOIN blog_posts bp ON ns.blog_post_id=bp.id').all();
      const ins = db.prepare('INSERT OR IGNORE INTO email_sends (id, type, subject, sent_at, sent_by, recipients_count, blog_post_id) VALUES (?,?,?,?,?,?,?)');
      nsSends.forEach(s => {
        ins.run(s.id, 'newsletter', s.title || 'Newsletter', s.sent_at, s.sent_by, s.recipients_count, s.blog_post_id);
      });
    }
  } catch(e) { /* newsletter_sends might not have data yet */ }

  // Beta signups table
  db.exec(`
    CREATE TABLE IF NOT EXISTS beta_signups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      name TEXT,
      notified_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_beta_email ON beta_signups(email);

    CREATE TABLE IF NOT EXISTS shopping_list_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      quantity TEXT,
      source TEXT,
      source_url TEXT,
      notes TEXT,
      is_checked INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  // Add notified_at column if missing (table may already exist without it)
  try { db.exec('ALTER TABLE beta_signups ADD COLUMN notified_at TEXT'); } catch(e) { /* already exists */ }
  safeAdd('users', 'is_beta_tester', 'INTEGER DEFAULT 0');
  safeAdd('blog_posts', 'view_count', 'INTEGER DEFAULT 0');

  // Sync beta signups to lifetime beta access on startup
  try {
    const betaRows = db.prepare('SELECT LOWER(email) as email FROM beta_signups').all();
    if (betaRows.length) {
      const syncBetaUser = db.prepare(`
        UPDATE users
        SET tier='top', billing_period='promo', plan_expires_at=NULL, is_beta_tester=1
        WHERE LOWER(email)=? AND LOWER(email) != 'christinaworkmanpottery@gmail.com'
      `);
      betaRows.forEach(row => syncBetaUser.run(row.email));
    }
  } catch (e) {
    console.error('Beta tester upgrade sync failed:', e.message);
  }

  // Project enhancements: priority, contacts, shopping, calendar
  safeAdd('projects', 'priority', "TEXT DEFAULT 'medium'");
  safeAdd('projects', 'contact_name', 'TEXT');
  safeAdd('projects', 'contact_email', 'TEXT');
  safeAdd('projects', 'contact_phone', 'TEXT');
  safeAdd('projects', 'contact_notes', 'TEXT');
  safeAdd('projects', 'shopping_list', 'TEXT');
  safeAdd('projects', 'budget', 'TEXT');
  safeAdd('projects', 'notes', 'TEXT');

  // Migration: update firing_logs CHECK constraint to include 'lustre'
  try {
    const flSchema = db.prepare("SELECT sql FROM sqlite_master WHERE name='firing_logs'").get();
    if (flSchema && flSchema.sql && flSchema.sql.includes("firing_type") && !flSchema.sql.includes("'lustre'")) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS firing_logs_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          piece_id TEXT,
          firing_type TEXT CHECK(firing_type IN ('bisque', 'glaze', 'lustre', 'raku', 'pit', 'wood', 'soda', 'salt', 'maintenance', 'element-change', 'thermocouple', 'preheat', 'soak', 'other')),
          cone TEXT,
          temperature TEXT,
          atmosphere TEXT CHECK(atmosphere IN ('oxidation', 'reduction', 'neutral', NULL)),
          kiln_name TEXT,
          schedule TEXT,
          duration TEXT,
          firing_speed TEXT CHECK(firing_speed IN ('slow', 'medium', 'fast', 'custom', NULL)),
          custom_speed_detail TEXT,
          hold_used INTEGER DEFAULT 0,
          hold_duration TEXT,
          date TEXT,
          results TEXT,
          notes TEXT,
          firing_time TEXT,
          firing_mode TEXT DEFAULT 'kiln-load',
          load_description TEXT,
          firing_mode_notes TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE SET NULL
        );
        INSERT INTO firing_logs_new SELECT id, user_id, piece_id, firing_type, cone, temperature, atmosphere, kiln_name, schedule, duration, firing_speed, custom_speed_detail, hold_used, hold_duration, date, results, notes, firing_time, firing_mode, load_description, firing_mode_notes, created_at FROM firing_logs;
        DROP TABLE firing_logs;
        ALTER TABLE firing_logs_new RENAME TO firing_logs;
        CREATE INDEX IF NOT EXISTS idx_firing_user ON firing_logs(user_id);
      `);
      console.log('[migration] Updated firing_logs CHECK constraint to include lustre');
    }
  } catch(e) { console.warn('[migration] firing_logs lustre migration:', e.message); }

  // One-time cleanup: remove ghost "Untitled" pieces with no real data (from iOS FormData bug)
  try {
    const deleted = db.prepare("DELETE FROM pieces WHERE (title IS NULL OR title = '' OR title = 'Untitled Piece') AND (description IS NULL OR description = '') AND (notes IS NULL OR notes = '')").run();
    if (deleted.changes > 0) console.log(`[cleanup] Removed ${deleted.changes} ghost untitled pieces`);
  } catch(e) { /* ignore */ }

  // Backfill: retroactive announcement from 2026-05-08
  try {
    db.prepare(`INSERT OR IGNORE INTO email_sends (id, type, subject, sent_at, sent_by, recipients_count, blog_post_id)
      VALUES ('announce-2026-05-08-updates', 'announcement', 'Quick Heads Up - Updates Coming to The Potters Mud Room', '2026-05-08 22:00:00', NULL, 28, NULL)`).run();
  } catch(e) { /* ignore if already exists */ }

  // Seed starter blog posts (INSERT OR IGNORE by slug)
  const blogInsert = db.prepare(`INSERT OR IGNORE INTO blog_posts (id, title, slug, content, excerpt, author, is_published, published_at) VALUES (?,?,?,?,?,?,1,datetime('now'))`);

  blogInsert.run(
    'blog-001',
    '5 Tips for Tracking Your Pottery',
    '5-tips-for-tracking-your-pottery',
    `Every potter knows the frustration: you pull a beautiful piece out of the kiln, someone asks "what glaze is that?" — and you have absolutely no idea.\n\nTracking your pottery process might seem tedious, but it's the single best habit you can build as a ceramicist. Here are 5 tips to get started:\n\n**1. Log Every Piece Immediately**\nDon't wait until after the firing. The moment you finish forming a piece, record the clay body, technique, and any notes about the process. Future-you will thank past-you.\n\n**2. Photograph at Every Stage**\nWet clay looks completely different from bisque, which looks completely different from glazed. Take a quick photo at each stage — it only takes seconds and creates an invaluable visual record.\n\n**3. Track Your Clay Bodies**\nDifferent clays behave differently. Log the brand, type, cone range, and how each clay performs. Over time, you'll build a personal reference library that's worth its weight in... clay.\n\n**4. Build a Glaze Library**\nKeep detailed records of every glaze you use — commercial name, brand, how many coats, application method, and most importantly, result photos. This is how you go from guessing to knowing.\n\n**5. Note Your Failures Too**\nCracked pots, crawling glazes, unexpected colors — these "casualties" are your best teachers. Log what went wrong and what you think caused it. That's how you grow.\n\nThe Potter's Mud Room was built specifically for this. Start tracking today — it's free.`,
    'Every potter knows the frustration of pulling a beautiful piece from the kiln and having no idea what glaze was used. Here are 5 tips to start tracking your pottery process.',
    'Christina Workman'
  );

  blogInsert.run(
    'blog-002',
    'How to Build a Glaze Library That Actually Works',
    'how-to-build-a-glaze-library-that-actually-works',
    `If you're like most potters, your glaze "library" is a collection of bottles with faded labels, a few sticky notes, and a vague memory of which ones looked good together.\n\nLet's fix that.\n\n**Start With What You Have**\nDon't try to catalog every glaze in existence. Start with the 5-10 glazes you actually use regularly. For each one, record:\n- Brand and name\n- Cone range\n- Atmosphere (oxidation/reduction)\n- Surface finish (gloss, satin, matte)\n- How it looks on different clay bodies\n\n**Test Tiles Are Your Best Friend**\nMake test tiles with every clay body you use, and dip them in your glazes. Photograph the results. This is your real glaze library — not the manufacturer's catalog, but YOUR results in YOUR kiln.\n\n**Track Combinations**\nSome of the most beautiful effects come from layering glazes. When you find a combo that works, record it! Note which glaze went on first, how many coats of each, and the firing details.\n\n**Organize by What Matters to YOU**\nSome potters organize by color. Others by cone. Others by brand. There's no wrong answer — just pick a system and stick with it.\n\n**Share What You Learn**\nThe pottery community thrives on shared knowledge. When you find an amazing glaze combo, share it! Other potters will appreciate it, and you'll build connections.\n\nThe Potter's Mud Room has a built-in glaze library with room for photos, recipes, ingredients, and combo tracking. It's the glaze library you've been wishing for.`,
    'Most potters have a messy collection of bottles and sticky notes instead of a real glaze library. Here\'s how to build one that actually works.',
    'Christina Workman'
  );

  blogInsert.run(
    'blog-003',
    'From Studio to Sale: Tracking Your Pottery Business',
    'from-studio-to-sale-tracking-your-pottery-business',
    `Making pottery is art. Selling pottery is business. And if you want your art to pay the bills, you need to treat it like both.\n\n**Know Your Costs**\nEvery piece has costs: clay, glaze, kiln electricity/gas, studio rent, your time. If you don't track these, you're probably underpricing your work. Most potters are.\n\n**Price With Confidence**\nOnce you know your costs, pricing becomes less stressful. A simple formula: (material cost + firing cost + time × your hourly rate) × 2 for wholesale, × 3 for retail. Adjust from there.\n\n**Track Every Sale**\nWhether it's an art fair, online order, gallery consignment, or a friend buying from your studio — log it. Track the date, price, venue, and which piece sold. Over time, this data tells you:\n- What forms/glazes sell best\n- Which venues are most profitable\n- Your busiest selling seasons\n- Your average sale price\n\n**Art Fairs and Markets**\nBulk sale tracking is essential for art fairs. Record everything during the event while it's fresh — the item, quantity, and price. Your future self (and your accountant) will thank you.\n\n**Export for Taxes**\nCome tax season, you need organized records. Being able to export your sales data as a CSV saves hours of headache.\n\n**The Potter's Mud Room includes sales tracking with CSV export, cost tracking per piece, and venue analytics. Because potters deserve business tools built for how we actually work.**`,
    'Making pottery is art. Selling pottery is business. Here\'s how to track your pottery business from studio to sale.',
    'Christina Workman'
  );

      // Content Reports
    db.exec(`
    CREATE TABLE IF NOT EXISTS content_reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL,
      content_type TEXT NOT NULL,
      content_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      details TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (reporter_id) REFERENCES users(id)
    );
    `);

  // Push notification tokens
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      platform TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id)`);

  // Test Tile Library (Unlimited members only)
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_tiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT,
      glaze_id TEXT,
      glaze_name TEXT,
      clay_body_id TEXT,
      clay_name TEXT,
      cone TEXT,
      atmosphere TEXT CHECK(atmosphere IN ('oxidation', 'reduction', 'neutral', NULL)),
      application_method TEXT CHECK(application_method IN ('dip', 'brush', 'spray', 'pour', 'other', NULL)),
      coats INTEGER DEFAULT 1,
      thickness TEXT CHECK(thickness IN ('thin', 'medium', 'thick', NULL)),
      surface_result TEXT CHECK(surface_result IN ('gloss', 'satin', 'matte', 'crystal', 'metallic', 'other', NULL)),
      color_result TEXT,
      layered_over TEXT,
      layered_under TEXT,
      kiln_position TEXT,
      firing_schedule TEXT,
      photo_filename TEXT,
      photo_filename2 TEXT,
      photo_filename3 TEXT,
      notes TEXT,
      rating INTEGER CHECK(rating BETWEEN 1 AND 5 OR rating IS NULL),
      tags TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (glaze_id) REFERENCES glazes(id) ON DELETE SET NULL,
      FOREIGN KEY (clay_body_id) REFERENCES clay_bodies(id) ON DELETE SET NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_test_tiles_user ON test_tiles(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_test_tiles_glaze ON test_tiles(glaze_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_test_tiles_clay ON test_tiles(clay_body_id)`);

return db;
}

module.exports = { initDB, DB_PATH };
