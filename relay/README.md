# The contribute relay

A Cloudflare Worker at `https://contribute.wendellresearch.ai/thicken/v1/` that receives the photos thicken's users
contribute to the corner model thicken uses (PRIVACY.md, "Contributing photos"). It isn't part of the npm package. It
has its own `package.json` and lock, its tests run offline in the Workers runtime (`npm test`, `npm run check`), and
`.github/workflows/relay.yml` deploys it when `relay/` changes on main. Nobody deploys it by hand.

## The API

| | |
| --- | --- |
| `GET /thicken/v1/status` | `{"accepting":true}`, or `{"accepting":false,"reason":"paused"\|"not open"}`. 410 `{"reason":"ended"}` means stop for good. |
| `POST /thicken/v1/photos` | Multipart `photo` (JPEG) and `meta` (JSON). 201 `{id}`, or the first failure below. |
| `DELETE /thicken/v1/photos/:id` | Always 204, so it can't tell whether an id exists. Rate-limited like POST. |
| `GET /thicken/v1/admin/inbox?cursor=` | `{ids, cursor?}`, the cursor only when there's more. |
| `GET /thicken/v1/admin/photos/:id.jpg` and `.json` | The re-encoded photo, and `{meta, at, asn, prefix, ua, scores}`. |
| `DELETE /thicken/v1/admin/photos/:id` | Deletes a photo (a reject at review). Not recorded as forgotten. |
| `POST /thicken/v1/admin/pause`, `/resume` | Pauses or resumes intake. |
| `GET /thicken/v1/admin/incidents` | Incident rows, metadata only. |
| `GET /thicken/v1/admin/rejections` | `{at, reason, sexual, face, topic}` for each Workers AI rejection. |
| `GET /thicken/v1/admin/forgotten?since=<iso>` | `[{id, at}]`: photos their contributors deleted, so pull.ts deletes its copies. |

Admin routes need `Authorization: Bearer <ADMIN_TOKEN>`; anything else, and every other path, answers 404. No CORS
headers, and nothing is logged (`observability` is off).

An upload is checked in this order and stops at the first failure:

1. Not accepting: 503 `{reason}`.
2. Content-Length missing or over 1.5 MB, or more bytes than that arriving: 413.
3. `meta` isn't exactly `{v, thicken, consent, profile, faces}` (profile book, box, card or slab; up to 6 faces of 4
   corners in 0..1000; at most 4 KB): 400 `{reason:"meta"}`.
4. Not `FF D8 FF`, or the Images binding doesn't read a JPEG: 415. A side over 1024: 413.
5. The rate limiter (5 a minute) or a day cap (`PER_PREFIX_DAY`, `PER_ASN_DAY`, `GLOBAL_DAY`): 429. A client is keyed on
   its IPv4 address or IPv6 /64, stored only as `HMAC-SHA256(IP_SALT, …)`, 16 hex. Once `SPIKE_HOUR` photos are
   accepted within an hour, the next one sets `paused=auto` and gets 503.
6. An exact SHA-256 repeat: 409.
7. The known-abuse hash lists (below). A match: 422 `{reason:"rejected"}` and an incident. Every list erring: 503.
8. Re-encoded to a JPEG at quality 90. The Images binding keeps no metadata but an EXIF copyright tag (its default).
9. Workers AI (`@cf/cloudflare/clef-flash`, zero data retention) answers three yes/no questions with probabilities:
   422 `{reason:"sexual"}` at `SEXUAL_MAX` or more, `"face"` at `FACE_MAX` or more, `"topic"` under `TOPIC_MIN`. An
   error is 503.
10. Stored as `inbox/<id>.jpg` and `inbox/<id>.json`, with a D1 row: 201 `{id}`.

What it keeps: the inbox for 180 days (an R2 lifecycle rule); D1's photo rows (SHA-256, prefix hash, ASN) and
rejections for 180 days, and day counters for 2 (a daily Cron Trigger); forgotten ids and incidents until deleted by
hand. Only an incident keeps a full IP.

## Setting it up

Everything here is Mike's to do, once, with his own `npx wrangler login`. Until it's done, the deploy workflow says so
and deploys nothing, and the live relay (once deployed) answers "not open" until a hash list is configured.

1. **Storage, in the EU.** R2's jurisdiction is part of its binding (`"jurisdiction": "eu"` in `wrangler.jsonc`). D1's
   is set when the database is created and can't change later; it has no setting in `wrangler.jsonc`. KV holds only the
   pause flag.
   ```sh
   npx wrangler r2 bucket create thicken-contribute --jurisdiction eu
   npx wrangler d1 create thicken-contribute --jurisdiction eu
   npx wrangler kv namespace create FLAGS
   ```
   Put the D1 `database_id` and the KV `id` in `wrangler.jsonc` in place of the zeros.
2. **The tables:** `npx wrangler d1 execute thicken-contribute --remote --file schema.sql`.
3. **The lifecycle rule,** on `inbox/` only. `incidents/` must have none.
   ```sh
   npx wrangler r2 bucket lifecycle add thicken-contribute inbox-180-days inbox/ --expire-days 180 --jurisdiction eu
   ```
4. **The route:** `wrangler.jsonc` has `contribute.wendellresearch.ai` as a custom domain. The zone must be on the same
   account; the first deploy adds its DNS record.
5. **The secrets,** each with `npx wrangler secret put <NAME>`:
   - `ADMIN_TOKEN` and `IP_SALT`, each a fresh random string
     (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). `ADMIN_TOKEN` is also thicken's
     `THICKEN_INBOX_TOKEN` in its `.env`, for pull.ts. Changing `IP_SALT` resets the day caps.
   - The hash lists in use (next step).
6. **The deploy token.** In the Cloudflare dashboard, create an API token from the "Edit Cloudflare Workers" template,
   limited to Mike's account and the `wendellresearch.ai` zone. If a deploy can't attach the custom domain, add
   Zone · DNS · Edit for that zone. Save it as the repo secret `CLOUDFLARE_API_TOKEN`, and the account id as
   `CLOUDFLARE_ACCOUNT_ID`. Then merge (or run the workflow by hand) to deploy.
7. **The hash lists.** Apply for each; every one that's configured is asked, in parallel, with a 5 s timeout each. A
   match on any is a match; with none, the upload goes on if at least one list answered. The relay opens once one list
   is configured.
   | List | Apply | Secrets | Code |
   | --- | --- | --- | --- |
   | Offlimits Hash Check Service (NL) | hashcheckservice.nl | `HASHCHECK_URL`, `HASHCHECK_KEY` | To write in `src/known.ts` from its docs |
   | Arachnid Shield (Canadian Centre for Child Protection) | projectarachnid.ca | `ARACHNID_USER`, `ARACHNID_KEY` | Written, from its SDKs |
   | Microsoft PhotoDNA Cloud Service (US) | microsoft.com/photodna | `PHOTODNA_KEY`, and `PHOTODNA_URL` if the portal names another endpoint | Written; check it against the portal's sample code |
   | NCMEC Hash Sharing (US) | esp.ncmec.org (ESP registration) | `NCMEC_USER`, `NCMEC_KEY` | To write in `src/known.ts` once there's access |

   Set a list's secrets only once its code is written: until then it errs on every photo, which stops intake if it's
   the only list.
8. **Calibrating the thresholds** on Mike's own photos, before opening: point a local thicken at the relay
   (`THICKEN_CONTRIBUTE_URL`), contribute a few dozen of his own frames, including ones with a hand, a reflection, a
   face, and off-topic ones, and read the scores in `GET /thicken/v1/admin/rejections` and in each kept photo's JSON.
   The thresholds and caps are `vars` in `wrangler.jsonc`: change them there and merge.

To pause by hand, `POST /thicken/v1/admin/pause`. To end contributing for good, so clients stop asking:
`npx wrangler kv key put --binding FLAGS --remote paused ended` (status answers 410).

## Incident procedure

A match on a hash list keeps the received bytes, never re-encoded, at `incidents/<id>.jpg`, which no endpoint serves and
no lifecycle rule touches, and writes an incident row: the id, time, SHA-256, full IP, ASN, user agent, the lists that
matched and those that answered. Intake is paused (`paused=incident`). US law (18 U.S.C. § 2258A) then requires a report
to NCMEC and preserving the contents for 1 year (§ 2258A(h)).

1. Don't open or download the file.
2. Intake is already paused. Read the row with `GET /thicken/v1/admin/incidents`.
3. Register with NCMEC's CyberTipline as an electronic service provider if you haven't (§ 2258A(a)(1)(B)(i)), and
   report the incident there.
4. Ask NCMEC how to transmit the preserved file without viewing it.
5. Keep it 1 year in the locked prefix, then delete it:
   `npx wrangler r2 object delete thicken-contribute/incidents/<id>.jpg --remote --jurisdiction eu`.

Resume intake (`POST /thicken/v1/admin/resume`) only once the report is made.
