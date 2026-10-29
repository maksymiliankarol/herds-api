# DEV

## Daily Git

```bash
git status                      # see what changed
git add .                       # stage everything
git commit -m "Describe change" # commit
git push                        # push to remote
```

Useful extras:

```bash
git diff                        # review unstaged changes before committing
git log --oneline -5            # last 5 commits
git pull                        # get the latest changes
```

## Migrations

```bash
wrangler d1 migrations create herds-db add_something   # makes 0002_add_something.sql
pnpm db:migrate                                         # local
pnpm db:migrate:prod                                    # asks for confirmation, then applies
```

## Setup

Load the admin token into the current shell (needed for every admin API call):

```bash
export ADMIN_TOKEN=$(grep '^ADMIN_TOKEN=' .dev.vars | cut -d= -f2-)
```

Reset the local state and re-apply the schema (wipes D1 and all Durable Object storage):

```bash
rm -rf .wrangler/state
pnpm wrangler d1 execute herds-db --local --file=schema.sql
```

For the deployed database use `--remote` instead of `--local` in every command below.
There are no API routes for countries and cities yet, so those are managed here.

### Countries

```bash
# create
pnpm wrangler d1 execute herds-db --local --command="INSERT INTO countries (code, name) VALUES ('de', 'Germany')"

# list
pnpm wrangler d1 execute herds-db --local --command="SELECT * FROM countries ORDER BY name"
```

### Cities

```bash
# create
pnpm wrangler d1 execute herds-db --local --command="INSERT INTO cities (slug, name, country) VALUES ('gdansk', 'Gdansk', 'pl')"

# list all, with country
pnpm wrangler d1 execute herds-db --local --command="SELECT cities.id, cities.slug, cities.name, countries.name AS country FROM cities JOIN countries ON countries.code = cities.country ORDER BY countries.name, cities.name"

# list cities of one country
pnpm wrangler d1 execute herds-db --local --command="SELECT slug, name FROM cities WHERE country = 'pl'"

# rename a city (the slug stays the same, so URLs keep working)
pnpm wrangler d1 execute herds-db --local --command="UPDATE cities SET name = 'Gdańsk' WHERE slug = 'gdansk'"

# delete (cascades to its rooms and news rows, but NOT to Durable Object storage:
# delete the city's rooms through the API first)
pnpm wrangler d1 execute herds-db --local --command="DELETE FROM cities WHERE slug = 'gdansk'"
```

### Rooms (read-only here; create and delete through the API)

Creating a room via SQL works, but deleting one via SQL leaves its chat messages behind in the Durable Object, so use the API for deletes.

```bash
# list all rooms with their city
pnpm wrangler d1 execute herds-db --local --command="SELECT rooms.id, cities.slug AS city, rooms.slug, rooms.title FROM rooms JOIN cities ON cities.id = rooms.city_id ORDER BY cities.slug, rooms.slug"

# list rooms of one city
pnpm wrangler d1 execute herds-db --local --command="SELECT rooms.id, rooms.slug, rooms.title FROM rooms JOIN cities ON cities.id = rooms.city_id WHERE cities.slug = 'warsaw'"

# create (the API route does the same)
pnpm wrangler d1 execute herds-db --local --command="INSERT INTO rooms (city_id, slug, title) SELECT id, 'food', 'Food' FROM cities WHERE slug = 'warsaw'"
```

### News

```bash
# list news of a room
pnpm wrangler d1 execute herds-db --local --command="SELECT news.id, news.title, news.created_at FROM news JOIN rooms ON rooms.id = news.room_id JOIN cities ON cities.id = rooms.city_id WHERE cities.slug = 'warsaw' AND rooms.slug = 'general' ORDER BY news.created_at DESC"

# delete one item by id
pnpm wrangler d1 execute herds-db --local --command="DELETE FROM news WHERE id = 1"
```

## Working with the API

Admin routes need `-H "authorization: Bearer $ADMIN_TOKEN"` (double quotes, so the shell expands the variable). Add `-i` to curl to see status codes, since a successful `204` prints nothing.

### Countries

```bash
# create (admin): code is the 2-letter ISO code
curl -X POST localhost:8787/countries \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"code":"de","name":"Germany"}'

# create again -> 409
curl -i -X POST localhost:8787/countries \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"code":"de","name":"Germany"}'

# delete (admin): only works when the country has no cities -> otherwise 409
curl -i -X DELETE localhost:8787/countries/de \
  -H "authorization: Bearer $ADMIN_TOKEN"
```

### Cities

```bash
# search (empty q lists everything, max 20)
curl "localhost:8787/cities?q=war"
curl "localhost:8787/cities"

# create (admin); the country must already exist
curl -X POST localhost:8787/cities \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"slug":"gdansk","name":"Gdansk","country":"pl"}'

# create again -> 409
curl -i -X POST localhost:8787/cities \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"slug":"gdansk","name":"Gdansk","country":"pl"}'

# delete (admin): wipes the city's rooms (including Durable Object chat storage) and news
curl -i -X DELETE localhost:8787/cities/gdansk \
  -H "authorization: Bearer $ADMIN_TOKEN"
```

### Rooms

```bash
# list rooms of a city -> { city, rooms }
curl localhost:8787/cities/warsaw/rooms

# unknown city -> 404
curl localhost:8787/cities/nope/rooms

# create (admin)
curl -X POST localhost:8787/cities/warsaw/rooms \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"slug":"general","title":"General"}'

# create again -> 409
curl -X POST localhost:8787/cities/warsaw/rooms \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"slug":"general","title":"General"}'

# without the token -> 401
curl -X POST localhost:8787/cities/warsaw/rooms \
  -H 'content-type: application/json' \
  -d '{"slug":"food","title":"Food"}'

# delete (admin): wipes the room and its sub-rooms (slug_*): Durable Objects, registry rows and news
curl -i -X DELETE localhost:8787/cities/warsaw/rooms/general \
  -H "authorization: Bearer $ADMIN_TOKEN"
```

### News

```bash
# create (admin)
curl -X POST localhost:8787/cities/warsaw/rooms/general/news \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"title":"Welcome","body":"First post"}'

# list (public, newest first)
curl localhost:8787/cities/warsaw/rooms/general/news

# delete one by id (admin)
curl -X DELETE localhost:8787/cities/warsaw/rooms/general/news/1 \
  -H "authorization: Bearer $ADMIN_TOKEN"
```

### Messages

Messages can only be posted through the WebSocket. There is no HTTP post route.

```bash
# read history
curl localhost:8787/cities/warsaw/rooms/general/messages

# unregistered room -> 404
curl localhost:8787/cities/warsaw/rooms/nope/messages

# join live as "anna", then type {"body":"hello"} to send
pnpm dlx wscat -c "ws://localhost:8787/cities/warsaw/rooms/general/ws?name=anna"

# a second terminal with the same name -> closes with code 4409 (name taken)
```