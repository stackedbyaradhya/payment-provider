import { TransactionStatus } from './transaction.entity';
import {
  allowedNextStates,
  assertTransition,
  canTransition,
  IllegalTransitionError,
} from './transaction-state-machine';

const ALL: TransactionStatus[] = [
  'INITIATED',
  'PROCESSING',
  'RETRYING',
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
];

const EXPECTED: Record<TransactionStatus, TransactionStatus[]> = {
  INITIATED: ['PROCESSING', 'FAILED'],
  PROCESSING: ['AUTHORIZED', 'RETRYING', 'FAILED'],
  RETRYING: ['PROCESSING', 'FAILED'],
  AUTHORIZED: ['CAPTURED', 'FAILED'],
  CAPTURED: [],
  FAILED: [],
};

describe('TransactionStateMachine', () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const expected = EXPECTED[from].includes(to);
      it(`${expected ? 'allows' : 'rejects'} ${from} -> ${to}`, () => {
        expect(canTransition(from, to)).toBe(expected);
        if (expected) {
          expect(() => assertTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertTransition(from, to)).toThrow(IllegalTransitionError);
        }
      });
    }
  }

  it('exposes allowedNextStates for diagnostics', () => {
    expect([...allowedNextStates('PROCESSING')].sort()).toEqual(
      ['AUTHORIZED', 'FAILED', 'RETRYING'].sort(),
    );
    expect([...allowedNextStates('CAPTURED')]).toEqual([]);
  });
});
