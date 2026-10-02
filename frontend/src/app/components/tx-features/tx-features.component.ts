import { Component, ChangeDetectionStrategy, OnChanges, Input } from '@angular/core';
import { calcSegwitFeeGains, isFeatureActive } from '@app/bitcoin.utils';
import { TransactionFlags } from '@app/shared/filters.utils';
import { Transaction } from '@interfaces/electrs.interface';
import { StateService } from '@app/services/state.service';

@Component({
  selector: 'app-tx-features',
  templateUrl: './tx-features.component.html',
  styleUrls: ['./tx-features.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TxFeaturesComponent implements OnChanges {
  @Input() tx: Transaction;

  segwitGains = {
    realizedSegwitGains: 0,
    potentialSegwitGains: 0,
    potentialP2shSegwitGains: 0,
    potentialTaprootGains: 0,
    realizedTaprootGains: 0
  };
  isRbfTransaction: boolean;
  isTaproot: boolean;
  // Classified by the backend, which knows each input's funding height. Only
  // transactions spending pre-fork outputs are classified, since those are the
  // only ones a replay could apply to.
  // 'protected': spends pre-fork outputs, but a SIGHASH_UNIFIED signature makes
  // the transaction invalid on the SHA256d chain.
  // 'possible': spends pre-fork outputs with no opted-in signature.
  // 'unknown': the question does not apply, or prevouts were skipped. No badge.
  replayProtection: 'protected' | 'possible' | 'unknown' = 'unknown';

  segwitEnabled: boolean;
  rbfEnabled: boolean;
  taprootEnabled: boolean;

  constructor(
    private stateService: StateService,
  ) { }

  ngOnChanges() {
    if (!this.tx) {
      return;
    }
    this.segwitEnabled = !this.tx.status.confirmed || isFeatureActive(this.stateService.network, this.tx.status.block_height, 'segwit');
    this.taprootEnabled = !this.tx.status.confirmed || isFeatureActive(this.stateService.network, this.tx.status.block_height, 'taproot');
    this.rbfEnabled = !this.tx.status.confirmed || isFeatureActive(this.stateService.network, this.tx.status.block_height, 'rbf');
    this.segwitGains = calcSegwitFeeGains(this.tx);
    this.isRbfTransaction = this.tx.vin.some((v) => v.sequence < 0xfffffffe);
    this.isTaproot = this.tx.vin.some((v) => v.prevout && v.prevout.scriptpubkey_type === 'v1_p2tr');
    this.replayProtection = this.classifyReplayProtection();
  }

  private classifyReplayProtection(): 'protected' | 'possible' | 'unknown' {
    const flags = this.tx.flags ? BigInt(this.tx.flags) : 0n;
    if (flags & TransactionFlags.replay_protected) { return 'protected'; }
    if (flags & TransactionFlags.replay_possible) { return 'possible'; }
    return 'unknown';
  }
}
