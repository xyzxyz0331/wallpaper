-- Run this ONLY if you already created the table with the old schema.
-- Skip if you are starting fresh (just run init.sql instead).

ALTER TABLE wallpapers
  CHANGE COLUMN filename   filename_original VARCHAR(255) NOT NULL,
  ADD COLUMN filename_webp  VARCHAR(255) NOT NULL DEFAULT '' AFTER filename_original,
  ADD COLUMN size_original  INT NOT NULL DEFAULT 0,
  ADD COLUMN size_webp      INT NOT NULL DEFAULT 0,
  ADD COLUMN views          INT NOT NULL DEFAULT 0,
  ADD COLUMN downloads      INT NOT NULL DEFAULT 0;

-- If you had an old `size` column:
-- ALTER TABLE wallpapers CHANGE COLUMN size size_original INT NOT NULL DEFAULT 0;
