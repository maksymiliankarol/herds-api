-- Name city columns by purpose: title is displayed, search is matched against
ALTER TABLE cities RENAME COLUMN city_label TO title;
ALTER TABLE cities RENAME COLUMN city TO search;

-- No duplicate cities or rooms (case-insensitive)
CREATE UNIQUE INDEX idx_cities_title_country ON cities(title COLLATE NOCASE, country_code);
CREATE UNIQUE INDEX idx_rooms_city_title ON rooms(city_id, title COLLATE NOCASE);