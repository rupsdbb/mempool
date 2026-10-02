import { Common } from '../../api/common';
import { MempoolTransactionExtended, TransactionExtended } from '../../mempool.interfaces';

const randomTransactions = require('./test-data/transactions-random.json');
const replacedTransactions = require('./test-data/transactions-replaced.json');
const rbfTransactions = require('./test-data/transactions-rbfs.json');
const nonStandardTransactions = require('./test-data/non-standard-txs.json');

describe('Common', () => {
  describe('RBF', () => {
    const newTransactions = rbfTransactions.concat(randomTransactions);
    test('should detect RBF transactions with fast method', () => {
      const result: { [txid: string]: { replaced: MempoolTransactionExtended[], replacedBy: TransactionExtended }} = Common.findRbfTransactions(newTransactions, replacedTransactions);
      expect(Object.values(result).length).toEqual(2);
      expect(result).toHaveProperty('7219d95161f3718335991ac6d967d24eedec370908c9879bb1e192e6d797d0a6');
      expect(result).toHaveProperty('5387881d695d4564d397026dc5f740f816f8390b4b2c5ec8c20309122712a875');
    });

    test('should detect RBF transactions with scalable method', () => {
      const result: { [txid: string]: { replaced: MempoolTransactionExtended[], replacedBy: TransactionExtended }} = Common.findRbfTransactions(newTransactions, replacedTransactions, true);
      expect(Object.values(result).length).toEqual(2);
      expect(result).toHaveProperty('7219d95161f3718335991ac6d967d24eedec370908c9879bb1e192e6d797d0a6');
      expect(result).toHaveProperty('5387881d695d4564d397026dc5f740f816f8390b4b2c5ec8c20309122712a875');
    });
  });

  describe('Mempool Goggles', () => {
    test('should detect nonstandard transactions', () => {
      nonStandardTransactions.forEach((tx) => {
        expect(Common.isNonStandard(tx)).toEqual(true);
      });
    });

    test('should not misclassify as nonstandard transactions', () => {
      randomTransactions.forEach((tx) => {
        expect(Common.isNonStandard(tx)).toEqual(false);
      });
    });
  });

  describe('Effective Fee Statistics', () => {
    test('returns safe defaults for blocks with only coinbase', () => {
      const coinbaseTx = { weight: 1000, fee: 0, txid: 'coinbase0' };
      const result = Common.calcEffectiveFeeStatistics([coinbaseTx]);

      expect(result.medianFee).toBe(0);
      expect(result.feeRange).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });

    test('excludes coinbase from fee stats when multiple txs', () => {
      const coinbaseTx = { weight: 1000, fee: 0, txid: 'coinbase0' };
      const tx1 = { weight: 400, fee: 100, txid: 'tx1' }; // vsize 100, rate 1 sat/vB
      const tx2 = { weight: 400, fee: 250, txid: 'tx2' }; // vsize 100, rate 2.5 sat/vB

      const result = Common.calcEffectiveFeeStatistics([coinbaseTx, tx1, tx2]);

      // Verify that coinbase (fee 0) was excluded from stats
      // Fee range min/max should be > 0 (not affected by coinbase's 0 fee)
      expect(result.feeRange[0]).toBeGreaterThan(0); // min fee
      expect(result.feeRange[6]).toBeGreaterThan(0); // max fee
    });
  });

  describe('getBlake2bDifficulty', () => {
    test('should match difficulty_blake2b as reported by Bitcoin Knots', () => {
      // bits and `difficulty_blake2b` from `getblockheader` on Bitcoin Knots v29.4.2, which prints 16 significant digits
      const vectors: [number, string][] = [
        [0x1a008d4f, '1.305422662852701e+17'], // mainnet #961640, first BLAKE2b block
        [0x193c2d40, '3.065426710290093e+17'], // mainnet #965664
        [0x190141c0, '1.467712970588856e+19'], // mainnet #973163
      ];
      for (const [bits, expected] of vectors) {
        expect(Common.getBlake2bDifficulty(bits).toPrecision(16)).toEqual(Number(expected).toPrecision(16));
      }
    });

    test('should return 0 for a null, negative or overflowing target', () => {
      expect(Common.getBlake2bDifficulty(0x1d000000)).toEqual(0);
      expect(Common.getBlake2bDifficulty(0x1d800001)).toEqual(0);
      expect(Common.getBlake2bDifficulty(0x23000001)).toEqual(0);
    });
  });

  describe('getReplayRisk', () => {
    const FORK = 961640;
    const pubkey = '02' + '11'.repeat(32);
    // A well-formed DER signature followed by the given sighash byte
    const derSig = (hashtype: string): string => '3044' + '0220' + 'aa'.repeat(32) + '0220' + 'bb'.repeat(32) + hashtype;
    const multisig2of3 = '52' + ('21' + pubkey).repeat(3) + '53' + 'ae';

    const vin = (height: number, coinbase: boolean, type: string, spend: { scriptsig?: string, witness?: string[] }): any => ({
      txid: '00'.repeat(32), vout: 0, is_coinbase: false, sequence: 0xffffffff,
      scriptsig: spend.scriptsig || '', witness: spend.witness,
      prevout: { scriptpubkey_type: type, scriptpubkey: '', value: 1000 },
      prevoutHeight: height, prevoutCoinbase: coinbase,
    });
    const p2wpkh = (height: number, coinbase: boolean, hashtype: string): any => vin(height, coinbase, 'v0_p2wpkh', { witness: [derSig(hashtype), pubkey] });
    const tx = (vins: any[], blockHeight?: number): any => ({
      txid: 'ff'.repeat(32), version: 2, locktime: 0, vin: vins, vout: [],
      status: blockHeight === undefined ? { confirmed: false } : { confirmed: true, block_height: blockHeight },
    });

    test('should show no badge when an input was minted by a post-fork coinbase', () => {
      expect(Common.getReplayRisk(tx([p2wpkh(FORK + 10, true, '01')]))).toBeNull();
      // one such input rules out a replay even alongside a replayable pre-fork input
      expect(Common.getReplayRisk(tx([p2wpkh(FORK - 10, false, '01'), p2wpkh(FORK, true, '01')]))).toBeNull();
      // and the rule is the same with a unified signature
      expect(Common.getReplayRisk(tx([p2wpkh(FORK + 10, true, '21')]))).toBeNull();
    });

    test('should flag a spend of post-fork non-coinbase outputs, whose creator may itself have been replayed', () => {
      expect(Common.getReplayRisk(tx([p2wpkh(FORK + 10, false, '01')]))).toBe(true);
      expect(Common.getReplayRisk(tx([p2wpkh(-1, false, '01')]))).toBe(true); // unconfirmed parent
      expect(Common.getReplayRisk(tx([p2wpkh(FORK + 10, false, '21')]))).toBe(false);
    });

    test('should classify pre-fork outputs by their signatures', () => {
      expect(Common.getReplayRisk(tx([p2wpkh(FORK - 1, false, '01')]))).toBe(true);
      expect(Common.getReplayRisk(tx([p2wpkh(FORK - 1, true, '01')]))).toBe(true); // a pre-fork coinbase exists on both chains
      expect(Common.getReplayRisk(tx([p2wpkh(FORK - 1, false, '01'), p2wpkh(FORK - 1, false, 'a1')]))).toBe(false);
    });

    test('should not classify transactions it cannot answer for', () => {
      expect(Common.getReplayRisk(tx([p2wpkh(FORK - 1, false, '01')], FORK - 1))).toBeNull(); // shared history
      const unfetched = p2wpkh(FORK - 1, false, '21');
      delete unfetched.prevoutCoinbase;
      expect(Common.getReplayRisk(tx([unfetched]))).toBeNull();
    });

    test('should trust a unified signature only where a standard template checks it', () => {
      const p2pkh = (scriptsig: string): any => tx([vin(FORK - 1, false, 'p2pkh', { scriptsig })]);
      expect(Common.getReplayRisk(p2pkh('47' + derSig('21') + '21' + pubkey))).toBe(false);
      // a unified signature dropped before the real one is never checked
      expect(Common.getReplayRisk(p2pkh('47' + derSig('21') + '75' + '47' + derSig('01') + '21' + pubkey))).toBe(true);

      const p2wsh = (witness: string[]): any => tx([vin(FORK - 1, false, 'v0_p2wsh', { witness })]);
      expect(Common.getReplayRisk(p2wsh(['', derSig('01'), derSig('21'), multisig2of3]))).toBe(false);
      // anything but the NULLDUMMY element and exactly m signatures is not trusted
      expect(Common.getReplayRisk(p2wsh([derSig('21'), derSig('01'), derSig('01'), multisig2of3]))).toBe(true);
      // signature-shaped data under a script that is not multisig is not trusted
      expect(Common.getReplayRisk(p2wsh([derSig('21'), '7551']))).toBe(true);

      const p2tr = (witness: string[]): any => tx([vin(FORK - 1, false, 'v1_p2tr', { witness })]);
      const schnorr = (hashtype: string): string => 'cc'.repeat(64) + hashtype;
      expect(Common.getReplayRisk(p2tr([schnorr('21')]))).toBe(false);
      expect(Common.getReplayRisk(p2tr([schnorr('21'), '50' + 'dd'.repeat(4)]))).toBe(false); // with an annex
      expect(Common.getReplayRisk(p2tr(['cc'.repeat(64)]))).toBe(true); // SIGHASH_DEFAULT
      expect(Common.getReplayRisk(p2tr([schnorr('21'), '51', 'c0' + 'ee'.repeat(32)]))).toBe(true); // script path
    });
  });
});
