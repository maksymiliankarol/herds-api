# herds-api

## Admin 

### Create city

```bash
curl -X POST http://localhost:8787/cities \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"city":"warsaw","city_label":"Warsaw","country_code":"pl"}'
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