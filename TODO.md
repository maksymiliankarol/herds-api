# TODO

## Mark ads in the news feed (`is_ad`)

- [x] Migration `0003_is_ad.sql`: add `is_ad INTEGER NOT NULL DEFAULT 0 CHECK (is_ad IN (0, 1))` to `news` and `news_queue`.
- [x] Stripe `finalize`: copy `is_ad = 1` into `news_queue` for paid ads.
- [x] Cron `publishDueNews`: copy `is_ad` from `news_queue` to `news`.
- [x] `GET /news`: return `is_ad`.
- [x] Admin `POST /news`: always `is_ad = 0` (don't accept it from the body).
- [ ] UI (herds app): show an "Ad" / "Sponsored" label when `is_ad = 1`.
- [ ] Existing rows get 0. Fix by hand any paid ads already live in `news`.
- [ ] Update Terms and Privacy (EN/PL) and their "Last updated" date once the label is live.

## Chat

- Now same user can't enter chat on second device. Single network limit to one? If yes, let's make it like three. 