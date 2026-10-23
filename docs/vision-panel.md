# Vision through a panel gateway, or a roster of your own: a note to pick up

*Written 2026-10-21 from the Estate Sale sessions, for thicken. **Built 2026-10-22** (src/vision.ts `findBench`,
`panel`, `judge`), with two changes from this note, at Mike's choice: the bench is found by itself, not named in
`THICKEN_VISION_MODELS` (each run asks the gateway, now at `127.0.0.1:8122`, for `bench/vision` or a collection tagged
`vision`; the roster stands in when it's down or no seat answers), and a run without any vision says so in its review.
Since this note, the gateway forwards `image_url` parts to seats that can see, and `bench/vision` exists (members
gemini-3.8-flash, gemma-4-31b-it, qwen3.8-27b). User docs: USAGE.md, "Benchwarmers (a model bench)".*

## What Mike wants

A user chooses one of two setups for vision, and thicken works the same either way:

1. **A roster of their own:** two or three vision models named directly, on any OpenAI-compatible endpoint. This is what exists today (`THICKEN_VISION_URL`, `THICKEN_VISION_MODELS`).
2. **A collection on a panel gateway:** one model name such as `bench/vision` on [Benchwarmers](https://github.com/WendellResearch-AI/benchwarmers) or a similar app. The gateway fans the prompt out to the collection's members plus its explorer seats and returns every seat's answer. thicken settles them exactly as it settles its own roster's answers, and records a verdict per seat so the gateway learns who to trust.

The point of setup 2: every photo thicken processes becomes evidence about the vision roster with nobody retyping anything, and the explorer seats bring new vision models into real work.

## How vision works today (src/vision.ts)

- Each photo is letterboxed to 1000 × 1000 and sent as a data URL with a profile-specific prompt asking for JSON: the faces it shows with four corners in reading order, the reads (`title, subtitle, authors, series, publisher, edition` for a book) and one-word asks (`binding`).
- `consult()` asks the first two models of the roster at once (primary and peer); the rest stand in for a seat that fails, and one more is asked when the two disagree (`clash`: a disputed face, or an ask answered differently).
- `settle()` works per face name over any number of answers: two answers whose mean corner distance is under 3% of the diagonal (`AGREE`) agree, their corners are averaged, both models go in `by`; a face named by several in different places keeps the first and is disputed; a face only one model named while another answered without it is dropped (unless another model put a differently named face in the same place); mirror-wound corners are rejected.
- `readOf()` takes each read as given most often (`agreed`, `once`, `disputed`); asks are a majority vote. Corners are then snapped to real edges (`image.ts`). Training mode keeps every question and answer. `temperature 0`, `max_tokens 4000`, 180 s timeout per call.
- Measured 2026-10-21 on Mike's Open WebUI with `gemini-3.8-flash-high, google/gemma-4-31b-it, gemma4:cloud`: gemini answered in 18.5 s; a one-photo book run took about 115 s end to end with vision on, 4 s with it off (barcode and Open Library only).

## What the Benchwarmers gateway gives and refuses (GATEWAY.md, 2026-10-16 design)

- `POST /v1/chat/completions` with `"model": "bench/<collection>"`. Single-model names are refused by design (400): "the bench method only, no single-model routing".
- The reply's `choices[0].message.content` is markdown with one section per seat; beside it a `bench` field carries the seats as data: `{ panel, collection, shape, seats: [{ call, seat: "member"|"explorer", alias, status: "ok"|"empty"|"error", seconds, answer, error }], verdict: "POST http://127.0.0.1:8123/bench/verdict" }`.
- A verdict is `POST /bench/verdict {"call", "useful": true|false, "note", "real": [...], "false": [...]}`; the same verdict twice writes nothing.
- Since 2026-10-22 the gateway runs as the `Benchwarmers` Servy service at `http://127.0.0.1:8122/v1`, and `bench/<collection>:merged` returns one reconciled answer (every seat is still called and recorded). thicken should NOT use `:merged`: `settle()` needs each model's corners separately, and the per-seat answers are what let it post verdicts. The plain collection reply is the one to read. `"with": ["<alias>"]` in the request seats one named model as an explorer for that call.
- Not there yet, needed first: the gateway does not forward `image_url` content parts (its clients are text-only today), and a `vision` collection must exist.

## The change in thicken, kept small

- **One variable decides the setup.** Keep `THICKEN_VISION_URL` and `THICKEN_VISION_MODELS`. A roster of real model ids is setup 1, as today. A single name that is a collection (`bench/…`, or any name when the reply carries a `bench` field) is setup 2. No new variable unless a gateway needs its own key (`THICKEN_VISION_KEY` already serves).
- **`ask()` / `consult()`:** in setup 2, one request to the collection instead of two or three direct calls; map each `bench.seats[i]` with `status: "ok"` to an `Answer` (`model` = alias, `ms` = seconds × 1000, the JSON parsed from `answer` as now); an `empty` or `error` seat becomes an `Answer` with `error`. Feed them all to `settle()`, which already handles any number of answers, so the "ask a third on dispute" step disappears: the third seat is already in hand. Every seat stays in the sidecar's `vision` record, named, as today.
- **Verdicts, posted after settling, by call id:** `useful: true` for a seat in `by` of an agreed face or whose reads matched the agreed read; `useful: false` for a seat that errored, came back empty or gave no usable JSON; nothing for a seat whose face or read was disputed, because it may be the one that was right (the gateway lists it as owed, and a person can judge it later from the sidecar). Post in the background; a failed post never fails the run.
- **A similar app** that is not Benchwarmers: the same code works if the reply carries per-seat answers in a `bench`-shaped field; make the field name and the verdict URL overridable only if a second gateway ever appears (ponytail: not before).
- **Tests:** a fake gateway reply with three seats (two agreeing on the front, one empty) settles the same as three direct answers; the verdict payloads; setup 1 unchanged.

## Gateway-side work (Benchwarmers repo, P:\windsurf\benchwarmers)

1. Forward multimodal `content` arrays (text and `image_url` parts) to each seat unchanged; the builtin client (`metrics/client.py`) is the place.
2. A `bench/vision` collection with the current roster as members (`gemini-3.8-flash-high`, `google/gemma-4-31b-it`, `gemma4:cloud`; `moonshotai/kimi-k3` is deprecated), described for vision so explorer seats are chosen from models that take images (the catalog's capabilities).
3. (Done 2026-10-22: the gateway runs as the `Benchwarmers` Servy service.)

## Then, in Estate Sale

Nothing changes in its code. `.env`: `THICKEN_VISION_URL=http://127.0.0.1:8122/v1` and `THICKEN_VISION_MODELS=bench/vision`, then restart the server.
