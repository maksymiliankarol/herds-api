// Amounts are in the smallest currency unit (cents, grosze).
type Price = { amount: number; currency: string };

const DEFAULT_PRICE: Price = { amount: 1900, currency: "usd" };

// Price by the country of the room's city. Countries not listed use the default.
const PRICES: Record<string, Price> = {
  PL: { amount: 4900, currency: "pln" },
};

// null = room not found
export async function getAdPrice(db: D1Database, roomId: number): Promise<Price | null> {
  const row = await db
    .prepare("SELECT cities.country_code FROM rooms JOIN cities ON cities.id = rooms.city_id WHERE rooms.id = ?")
    .bind(roomId)
    .first<{ country_code: string }>();

  return row ? (PRICES[row.country_code] ?? DEFAULT_PRICE) : null;
}