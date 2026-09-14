// Owner: Person 6. Backs GET /audit/assets/:id.

import { useEffect, useState } from "react";
import { mockApi } from "../api/mockApi";
import { AuditEvent } from "../../../shared/types";

export function AuditTrailPage({ assetId }: { assetId: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);

  useEffect(() => {
    mockApi.getAssetAuditTrail(assetId).then(setEvents);
  }, [assetId]);

  return (
    <div>
      <h2>Audit Trail — {assetId}</h2>
      <ul>
        {events.map((e) => (
          <li key={e.eventId}>
            {e.timestamp} — {e.action} — by {e.actorIdentityId}
          </li>
        ))}
      </ul>
    </div>
  );
}
