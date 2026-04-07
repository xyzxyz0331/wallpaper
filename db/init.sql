-- Run this once in phpMyAdmin after creating the 'animewallpaperz' database

CREATE TABLE IF NOT EXISTS categories (
  id         INT          AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  created_at DATETIME     DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed default categories
INSERT IGNORE INTO categories (name) VALUES
  ('Dark Fantasy'), ('Romance'), ('Cyberpunk'),
  ('Nature'), ('Action'), ('Slice of Life'), ('Horror'), ('Other');

CREATE TABLE IF NOT EXISTS wallpapers (
  id                INT           AUTO_INCREMENT PRIMARY KEY,
  filename_original VARCHAR(255)  NOT NULL,   -- original file (.png/.jpg etc.) — for download
  filename_webp     VARCHAR(255)  NOT NULL,   -- converted WebP — displayed on website
  title             VARCHAR(255)  NOT NULL,
  tags              VARCHAR(500)  DEFAULT '',
  category          VARCHAR(100)  DEFAULT '',
  size_original     INT           DEFAULT 0,  -- bytes
  size_webp         INT           DEFAULT 0,  -- bytes

  -- Counters
  views             INT           DEFAULT 0,
  downloads         INT           DEFAULT 0,

  -- SEO fields
  slug              VARCHAR(255)  UNIQUE,
  alt_text          VARCHAR(500)  DEFAULT '',
  seo_title         VARCHAR(70)   DEFAULT '',
  meta_desc         VARCHAR(160)  DEFAULT '',
  og_title          VARCHAR(255)  DEFAULT '',
  og_description    VARCHAR(300)  DEFAULT '',

  uploaded_at       DATETIME      DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
