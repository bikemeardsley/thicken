// Label Studio (relay/label-studio.ts): a person's submitted review as a decision, as experiment 003 exports them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decision, fourCorners, type Annotation } from '../relay/label-studio.ts';

const shown = [[126, 70], [882, 54], [928, 971], [120, 955]];
const polygon = (corners: number[][], face = 'front') => ({ from_name: 'faces', type: 'polygonlabels', original_width: 1000, original_height: 1000,
  value: { points: corners.map(([x, y]) => [x / 10, y / 10]), closed: true, polygonlabels: [face] } });
const annotated = (result: object[], verdict = 'keep', extra: object[] = []): Annotation => ({ id: 1, updated_at: '2026-11-07T00:00:00Z',
  result: [...result, ...extra, { from_name: 'verdict', type: 'choices', value: { choices: [verdict] } }] as Annotation['result'] });

test('label studio: a submitted annotation is a keep, a fix or a reject, as experiment 003 exports them', () => {
  const proposal = [{ face: 'front', corners: shown }];
  assert.deepEqual(decision(annotated([polygon(shown)]), proposal), { verdict: 'keep', faces: proposal, at: '2026-11-07T00:00:00Z', someone: false });
  const moved = [shown[0], shown[1], [900, 950], shown[3]];
  assert.deepEqual(decision(annotated([polygon(moved)]), proposal), { verdict: 'fix', faces: [{ face: 'front', corners: moved }], at: '2026-11-07T00:00:00Z', someone: false });
  assert.equal((decision(annotated([]), proposal) as { verdict: string }).verdict, 'reject', 'every face deleted');
  // A point clicked on an edge goes; a shape with five real corners, or one going the wrong way round, is refused.
  assert.equal((decision(annotated([polygon([shown[0], [504, 62], ...shown.slice(1)])]), proposal) as { verdict: string }).verdict, 'keep');
  const house = [[100, 500], [500, 100], [900, 500], [900, 900], [100, 900]];
  assert.deepEqual(fourCorners(house), house);
  assert.ok('error' in decision(annotated([polygon(house)]), proposal));
  assert.ok('error' in decision(annotated([polygon([...moved].reverse())]), proposal));
  assert.equal((decision(annotated([polygon([...moved].reverse())], 'reject'), proposal) as { verdict: string }).verdict, 'reject');
  const spine = [[63, 70], [115, 84], [194, 78], [194, 967], [112, 975], [64, 958]]; // review 1, a thin face: corners survive
  assert.deepEqual(fourCorners(spine), [[63, 70], [194, 78], [194, 967], [64, 958]]);
  // A hand boxed, and someone else in frame, go with the decision.
  const hand = { from_name: 'obstruction', type: 'rectanglelabels', original_width: 1000, original_height: 1000, value: { x: 10, y: 20, width: 5, height: 7.5, rectanglelabels: ['hand'] } };
  const people = { from_name: 'people', type: 'choices', value: { choices: ['someone else in frame'] } };
  assert.deepEqual(decision(annotated([polygon(shown)], 'keep', [hand, people]), proposal),
    { verdict: 'keep', faces: proposal, obstructions: [{ what: 'hand', box: [100, 200, 150, 275] }], at: '2026-11-07T00:00:00Z', someone: true });
});
