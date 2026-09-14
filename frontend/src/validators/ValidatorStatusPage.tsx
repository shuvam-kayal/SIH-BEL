// Owner: Person 6. Backs GET /blockchain/status, /blockchain/validators,
// /blockchain/committee/:height. Visible to all roles per
// docs/RBAC_MATRIX.md.

import { useEffect, useState } from "react";
import { mockApi } from "../api/mockApi";
import { Validator } from "../../../shared/types";

export function ValidatorStatusPage() {
  const [validators, setValidators] = useState<Validator[]>([]);
  const [status, setStatus] = useState<{ height: number; healthy: boolean } | null>(null);

  useEffect(() => {
    mockApi.getValidators().then(setValidators);
    mockApi.getBlockchainStatus().then(setStatus);
  }, []);

  return (
    <div>
      <h2>Blockchain Status</h2>
      {status && (
        <p>
          Height: {status.height} — {status.healthy ? "Healthy" : "Degraded"}
        </p>
      )}
      <h3>Validators</h3>
      <ul>
        {validators.map((v) => (
          <li key={v.validatorId}>
            {v.validatorId} — {v.status}
          </li>
        ))}
      </ul>
    </div>
  );
}
