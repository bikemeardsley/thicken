## What it adds

<!-- A new profile: what kind of object, and an example of one. An improvement: what it does better. Anything else: link the issue it was agreed in. -->

## For a profile ([CONTRIBUTING.md](../CONTRIBUTING.md))

- [ ] One file, `src/profiles/<name>.ts`, exporting one profile named as the file
- [ ] Tests in `test/profiles/<name>.test.ts`, on pictures the test draws or I made (in `test/fixtures/<name>/`); an improvement still passes the profile's own
- [ ] Nothing runs when the file loads; `read` claims only pictures that are certainly this kind of object
- [ ] Each standard size has its source in a comment
- [ ] `npm run readme`, `npm run check` and `npm test` pass (`thicken profile contribute` runs them)
- [ ] No new dependencies or command-line options
- [ ] Hosts it contacts, if any, listed here and recorded in the sidecar's `lookups`:
