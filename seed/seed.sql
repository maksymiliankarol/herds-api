-- seed so the cities page has something to show
INSERT INTO countries (code, name) VALUES ('pl', 'Poland');
INSERT INTO cities (slug, name, country) VALUES
  ('krakow', 'Krakow', 'pl'),
  ('warsaw', 'Warsaw', 'pl');