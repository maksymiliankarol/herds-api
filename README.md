# herds-api

## Rooms tree logic

each room has a name like `food`. Child room for such room would be `food_child`. So `_` is a separator that makes a child. Also ui would show `Food` and `Child` (not `Food Child` child). 

## Rooms tree starting point

### EN

- general
- culture
- nightlife
- food
- sport
- beauty
- health
- housing
- jobs
- transport
- city
- recommendations
- hobbies

### PL

- ogólne
- kultura
- imprezy
- jedzenie
- sport
- uroda
- zdrowie
- mieszkanie
- praca
- komunikacja
- miasto
- polecajki
- hobby

## Admin 

### Create city

```bash
curl -X POST http://localhost:8787/cities \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Kraków","search":"krakow","country_code":"pl"}'
```

### Delete city

```bash
curl -X DELETE http://localhost:8787/cities/1 \
  -H "Authorization: Bearer $ADMIN_KEY"
```

### Create room

```bash
curl -X POST http://localhost:8787/rooms \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Neighbourhood chat","city_id":1}'
```

### Delete room

```bash
curl -X DELETE http://localhost:8787/rooms/1 \
  -H "Authorization: Bearer $ADMIN_KEY"
```

### Create a news

```bash
curl -X POST http://localhost:8787/news \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content":"Main street closed until Friday.","room_id":1}'
```

### Deleting a news

```bash
curl -X DELETE http://localhost:8787/news/1 \
  -H "Authorization: Bearer $ADMIN_KEY"
```

### See who is in a room (names + IPs)
```bash 
curl http://localhost:8787/rooms/1/users -H "Authorization: Bearer $ADMIN_KEY"
```

### Kick by name, ban their IP for 24h
```bash
curl -X POST http://localhost:8787/rooms/1/kick \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"username":"bob","ban_hours":24}'
```

```bash
### Kick by IP only (no ban)
curl -X POST http://localhost:8787/rooms/1/kick \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"ip":"1.2.3.4"}'
```

# Stripe

```bash
  stripe listen --forward-to localhost:8787/stripe/webhook
```