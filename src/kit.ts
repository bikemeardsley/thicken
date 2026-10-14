// What a profile builds with, in one place: thicken's own parts (finding faces in photos, building and writing
// geometry, foil, what the vision models saw) and the types a profile is made of. A profile in this repository imports
// from '../kit.ts'; one of your own, in ~/.thicken/profiles, from 'thicken/kit', the same parts.
export * from './faces.ts';
export * from './foil.ts';
export * from './glb.ts';
export * from './image.ts';
export { trace, type Point } from './outline.ts';
export { pooled, readOf, type Answer, type Seen, type Sight } from './vision.ts';
export type { Built, Code, Faces, Facts, Job, Options, Profile, Scanned } from './thicken.ts';
