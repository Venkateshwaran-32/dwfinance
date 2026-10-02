'use client';

import '@/styles/dashboard-cards.css';
import { formatCents } from '@/lib/money';
import type { Peer } from '@/server/peer-analytics';

export function PeerLedgerCard({ peers }: { peers: Peer[] }) {
  return (
    <section className="card card-pad">
      <h2 className="card-title">People</h2>
      <p className="card-sub">Who you paid and who paid you</p>

      {peers.length === 0 ? (
        <p className="dc-empty">No person-to-person transfers detected.</p>
      ) : (
        <ul className="dc-list">
          {peers.map((peer) => (
            <li key={peer.name} className="dc-row">
              <div className="dc-main">
                <span className="dc-name">
                  {peer.name} <span className="dc-dim">x{peer.count}</span>
                </span>
                <span className="dc-meta">
                  Paid <span className="amount">{formatCents(peer.paidCents)}</span>
                  {' · '}
                  Received <span className="amount in">{formatCents(peer.receivedCents)}</span>
                </span>
              </div>
              <span className={`amount dc-amt${peer.netCents < 0 ? ' in' : ''}`}>{netLabel(peer.netCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function netLabel(netCents: number): string {
  if (netCents > 0) return `-${formatCents(netCents)}`;
  if (netCents < 0) return `+${formatCents(Math.abs(netCents))}`;
  return formatCents(0);
}
