# Privacy policy

*Effective 8 November 2026.*

thicken runs on your own machine. It has no account and no telemetry, and
nothing you do with it reaches the author unless you say yes to
[contributing photos](#contributing-photos). Until you do, that is off.

## What leaves your machine

Only these requests, and only when the job needs them:

- **Book lookups:** an ISBN, or the title and author read off a cover, to
  Open Library (`openlibrary.org`, `covers.openlibrary.org`), the Library of
  Congress (`lx2.loc.gov`) and Google Books (`www.googleapis.com`). A
  `GOOGLE_BOOKS_API_KEY`, if you set one, goes only to Google Books.
- **Vision, if you set it up:** with `THICKEN_VISION_URL` set, each photo,
  re-encoded without its EXIF data (so no GPS location), goes to that
  endpoint with `THICKEN_VISION_KEY`. You choose that endpoint; its own
  privacy policy applies.
- **Contributing a profile**, only if you run `thicken profile contribute`:
  `git` and the GitHub CLI push your profile to your fork and open a pull
  request, as you.
- **Contributing photos**, only if you said yes: each photo's frame and a
  short note about it go to thicken's upload point, as
  [below](#contributing-photos).

Nothing else is contacted. As an MCP server it talks only to the agent that
started it, over stdio, and never listens on a network port.

## What stays on your machine

The photos, PDFs and videos you give it are read locally. It writes each
model and its JSON sidecar where you tell it. Sidecars record the lookups made,
never an API key, GPS location or serial number. Training mode, only when you
set `THICKEN_DATASET`, saves the images it sent and their metadata into that
folder. Its reviewed half, only when you set `THICKEN_REVIEWS`, sends each
photo to the Label Studio you name for you to review, and saves the photo,
stripped of its metadata, and your review into that folder. Your answer about
contributing photos is kept in `~/.thicken/config.json`, and the photos you
contributed are listed in `~/.thicken/contributed.jsonl` (each one's id, time,
profile and file name, or why it was refused), which is never sent.
[SECURITY.md](SECURITY.md) has the full detail.

## Contributing photos

thicken can ask you, once, whether to contribute your photos to the corner
model thicken uses: the model that finds the corners of books, cards, slabs
and boxes in photos, which learns from photos like yours. It's voluntary.
Nothing is sent until you say yes, and saying no changes nothing else thicken
does. This section is the notice the EU's GDPR asks for (Art. 13).

- **Who is responsible:** Michael Beardsley (GitHub:
  [bikemeardsley](https://github.com/bikemeardsley)), thicken's author, a
  private person in the United States. The upload point runs at
  `contribute.wendellresearch.ai`: Wendell Research is his name for his
  research work, not a business. Contact him on GitHub:
  [open an issue](https://github.com/bikemeardsley/thicken/issues), or write
  privately through a
  [security advisory](https://github.com/bikemeardsley/thicken/security/advisories/new).
- **What is sent:** for each photo you make a model from with thicken's own
  book, box, card or slab profile (never one of your own profiles), once the
  model is written, the 1000 × 1000 JPEG frame thicken
  shows the vision models (the photo scaled to fit, with gray bars, without
  its EXIF data), and a note: thicken's version, the date of the question you
  said yes to, the profile, and the faces found in the frame with their
  corners and a confidence score. Never a badge or lettering, and nothing
  from a run with training mode on.
- **What isn't:** file names or paths, camera or lens, when or where the
  photo was taken, your computer's name, or anything else from the sidecar.
  No account, name or install id is attached. A photo can still show
  something about you, such as a name written in a book, so it isn't
  anonymous.
- **What the upload point records:** like any server, it sees your IP
  address. Beside each photo it keeps a keyed hash of that address (of an
  IPv6 address, its first half), your network's number (ASN), the user agent
  (thicken and its version), the time and the checks' scores, and it counts
  uploads a day by hashed address and by network, to cap them. Of a photo
  its image model refuses, it keeps only the reason and the scores.
- **The checks:** each photo is checked against lists of known child sexual
  abuse material, re-encoded (which strips any metadata left), and then
  refused if an image model finds it sexual, finds a face in it, or doesn't
  see a book, card, slab or box. These checks decide on their own. thicken
  sends silently: `thicken contribute list` shows each photo it sent, and
  the reason for any that was refused.
- **Why, and on what basis:** to train the corner model thicken uses, on
  photos the author has reviewed one by one. The basis is your consent (GDPR
  Art. 6(1)(a)), which is also what the ePrivacy Directive (Art. 5(3)) asks
  before software sends files from your device. The hashed address, the caps
  and the checks keep the upload point from being abused, a legitimate
  interest (Art. 6(1)(f)).
- **Who receives it:** Cloudflare runs the upload point and stores the photos
  in the EU, as the author's processor, under its data processing addendum
  (the EU's standard contractual clauses, and the EU–US Data Privacy
  Framework). Its image model runs on Cloudflare's network (Workers AI),
  which keeps nothing of the photos it checks. For the known-abuse check,
  each photo or its hash, whichever their services take, also goes to each
  of these that the upload point is set up with: the Canadian Centre for
  Child Protection (Arachnid Shield, Canada), Offlimits (the Netherlands),
  Microsoft (PhotoDNA Cloud Service, United States, which doesn't keep the
  images) and NCMEC (Hash Sharing, United States). The author copies each
  photo to his own computer in the United States to
  review it, in his own Label Studio. The photos aren't published or passed
  on to anyone else, except as the next point says.
- **If a photo matches known abuse material:** it is never reviewed or
  trained on. As US law requires (18 U.S.C. § 2258A), it is kept apart,
  unopened, for one year, with the full IP address it came from, the
  network, the user agent, the time, its SHA-256 hash and which lists
  matched it, and reported to the National Center for Missing & Exploited
  Children (NCMEC). The upload point then takes nothing more until the author has
  dealt with it.
- **How long:** a photo the author hasn't reviewed is deleted from the upload
  point after 180 days. One he rejects is deleted when he rejects it, from
  the upload point and from his copy. One he keeps stays for as long as the
  corner models thicken uses train on it, and every year he checks whether
  they still do. The upload point's own record of a photo (its id, SHA-256
  hash, time, hashed address and network) is deleted with it when you forget
  it or he rejects it, and otherwise after 180 days. Its daily counts of
  uploads per hashed address go after two days. Of a photo you forget, it
  keeps only the id and when you forgot it, so that his copy can follow.
- **Your rights:** stop any time with `thicken contribute off`; that doesn't
  undo what was sent before. `thicken contribute list` shows what you
  contributed, and `thicken contribute forget <id>` (or `--all`) deletes it
  from the upload point at once, and the author's copy and his review of it
  the next time he collects photos, however long after. A model already
  trained on a photo can't unlearn it, but no later one trains on it. To see what is held about a photo, or for your
  other rights under the GDPR (to correct, restrict, or get a copy), ask on
  GitHub with the photo's id; the private route keeps the id to you and him.
- **Complaints:** in the EU, you may complain to the data protection
  authority where you live.
- **Age:** you must be 16 or older to contribute photos.

## Third parties

The services above, npm (where thicken is installed from) and the AI
assistant you use it with each have their own privacy policies.

## Changes

Changes to this policy are made in this file, and its history is in the
repository's commits.

## Contact

Questions: [open an issue](https://github.com/bikemeardsley/thicken/issues).
