// The known-abuse hash lists (README.md). Every configured list is asked in parallel, each with its own 5 s timeout. A
// match on any list is a match; with none, the upload goes on if at least one list answered, or if none is configured.
// All configured lists erring throws, so the caller fails closed.
export type Lists = {
  HASHCHECK_URL?: string;
  HASHCHECK_KEY?: string;
  ARACHNID_USER?: string;
  ARACHNID_KEY?: string;
  PHOTODNA_URL?: string;
  PHOTODNA_KEY?: string;
  NCMEC_USER?: string;
  NCMEC_KEY?: string;
};
type Check = (bytes: Uint8Array, env: Lists, signal: AbortSignal) => Promise<boolean>;

export const LISTS: Record<string, { on: (env: Lists) => boolean; check: Check }> = {
  // Offlimits' Hash Check Service (NL, hashcheckservice.nl). Fill in once Mike has its API documentation.
  offlimits: {
    on: (env) => !!(env.HASHCHECK_URL && env.HASHCHECK_KEY),
    check: async () => {
      throw new Error('offlimits: not written yet');
    },
  },
  // Arachnid Shield (Canadian Centre for Child Protection), called as its official SDKs do: the bytes to /v1/media/
  // with basic auth. A scan names a classification; anything but "no-known-match" is a match.
  arachnid: {
    on: (env) => !!(env.ARACHNID_USER && env.ARACHNID_KEY),
    check: async (bytes, env, signal) => {
      const res = await fetch('https://shield.projectarachnid.com/v1/media/', {
        method: 'POST',
        headers: { authorization: `Basic ${btoa(`${env.ARACHNID_USER}:${env.ARACHNID_KEY}`)}`, 'content-type': 'image/jpeg' },
        body: bytes,
        signal,
      });
      if (!res.ok) throw new Error(`arachnid: ${res.status}`);
      const scan = await res.json<{ sha256_hex?: unknown; classification?: unknown }>();
      if (typeof scan.sha256_hex !== 'string') throw new Error('arachnid: no scan');
      return scan.classification != null && scan.classification !== 'no-known-match';
    },
  },
  // Microsoft PhotoDNA Cloud Service (US). Its reference is behind the subscriber portal; this is the Match call as
  // published before that: the bytes with the subscription key, answering Status.Code 3000 and IsMatch. Check it
  // against the portal's sample code on onboarding, and set PHOTODNA_URL if the endpoint differs.
  photodna: {
    on: (env) => !!env.PHOTODNA_KEY,
    check: async (bytes, env, signal) => {
      const res = await fetch(env.PHOTODNA_URL || 'https://api.microsoftmoderator.com/photodna/v1.0/Match', {
        method: 'POST',
        headers: { 'ocp-apim-subscription-key': env.PHOTODNA_KEY!, 'content-type': 'image/jpeg' },
        body: bytes,
        signal,
      });
      if (!res.ok) throw new Error(`photodna: ${res.status}`);
      const scan = await res.json<{ Status?: { Code?: unknown }; IsMatch?: unknown }>();
      if (scan.Status?.Code !== 3000 || typeof scan.IsMatch !== 'boolean') throw new Error('photodna: no match result');
      return scan.IsMatch;
    },
  },
  // NCMEC Hash Sharing (US), with the credentials from ESP registration at esp.ncmec.org. Fill in once Mike has access.
  ncmec: {
    on: (env) => !!(env.NCMEC_USER && env.NCMEC_KEY),
    check: async () => {
      throw new Error('ncmec: not written yet');
    },
  },
};

export async function known(bytes: Uint8Array, env: Lists): Promise<{ matched: string[]; answered: string[] }> {
  const names = Object.keys(LISTS).filter((name) => LISTS[name].on(env));
  const settled = await Promise.allSettled(names.map((name) => LISTS[name].check(bytes, env, AbortSignal.timeout(5_000))));
  const answered = names.filter((_, i) => settled[i].status === 'fulfilled');
  const matched = names.filter((_, i) => { const s = settled[i]; return s.status === 'fulfilled' && s.value; });
  if (names.length && !answered.length) throw new Error('no hash list answered');
  return { matched, answered };
}
