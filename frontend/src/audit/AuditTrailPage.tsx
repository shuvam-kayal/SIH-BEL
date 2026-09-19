import { useEffect, useState } from "react";
import { mockApi } from "../api/mockApi";
import type { AuditEvent } from "../../../shared/types";

export function AuditTrailPage({
  assetId,
}: {
  assetId: string;
}) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);

    mockApi
      .getAssetAuditTrail(assetId)
      .then((data) => {
        setEvents(data);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [assetId]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Audit Trail — {assetId}</h2>
          <p className="page-subtitle">
            History of actions performed on this asset
          </p>
        </div>
      </div>

      {loading ? (
        <div className="empty-state">
          Loading audit events...
        </div>
      ) : events.length === 0 ? (
        <div className="empty-state">
          No audit events available.
        </div>
      ) : (
        <div className="audit-list">
          {events.map((event) => (
            <div className="audit-row" key={event.eventId}>
              <div>
                <strong>{event.action}</strong>
                <div>Actor: {event.actorIdentityId}</div>
                <div>Transaction: {event.txId}</div>
                <div>
                  Entity: {event.entityType} — {event.entityId}
                </div>
              </div>

              <div>
                {new Date(event.timestamp).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
