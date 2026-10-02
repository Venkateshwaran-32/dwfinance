import 'server-only';

import type { Transaction } from '@prisma/client';
import { cleanMerchant, isPayNowToPerson } from '@/server/merchants';

export type Peer = {
  name: string;
  paidCents: number;
  receivedCents: number;
  netCents: number;
  count: number;
  lastDate: string;
};

const PEER_LIMIT = 10;

export function computePeers(txns: Transaction[]): Peer[] {
  const peers = new Map<string, Peer>();

  for (const txn of txns) {
    if (!isPayNowToPerson(txn.description, txn.counterparty)) continue;

    const name = cleanMerchant(txn.description, txn.counterparty).trim();
    if (!name) continue;

    const day = dateKey(txn.date);
    const peer = peers.get(name) ?? {
      name,
      paidCents: 0,
      receivedCents: 0,
      netCents: 0,
      count: 0,
      lastDate: day,
    };

    if (txn.amountCents < 0) peer.paidCents += -txn.amountCents;
    if (txn.amountCents > 0) peer.receivedCents += txn.amountCents;

    peer.netCents = peer.paidCents - peer.receivedCents;
    peer.count += 1;
    if (day > peer.lastDate) peer.lastDate = day;

    peers.set(name, peer);
  }

  return [...peers.values()]
    .sort((a, b) => {
      const totalDiff = (b.paidCents + b.receivedCents) - (a.paidCents + a.receivedCents);
      return totalDiff || b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name);
    })
    .slice(0, PEER_LIMIT);
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
