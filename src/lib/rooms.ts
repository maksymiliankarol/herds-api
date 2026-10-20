// city slug + room slug -> numeric room id (null if either doesn't exist)
export async function findRoomId(db: D1Database, city: string, slug: string): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT rooms.id FROM rooms
       JOIN cities ON cities.id = rooms.city_id
       WHERE cities.slug = ? AND rooms.slug = ?`,
    )
    .bind(city, slug)
    .first<{ id: number }>();
  return row?.id ?? null;
}

// The Durable Object is addressed by the room's immutable numeric id
export const roomStub = (env: CloudflareBindings, id: number) => env.ROOM.getByName(String(id));