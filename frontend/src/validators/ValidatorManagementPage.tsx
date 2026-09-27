import { useEffect, useState } from "react";
import { mockApi } from "../api/mockApi";
import type { ValidatorHistoryRecord, ValidatorRegistration } from "../../../shared/types";

export function ValidatorManagementPage() {
  const [validators, setValidators] = useState<ValidatorRegistration[]>([]);
  const [history, setHistory] = useState<ValidatorHistoryRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = async () => { setValidators(await mockApi.getValidators() as unknown as ValidatorRegistration[]); setHistory(await mockApi.getValidatorHistory()); };
  useEffect(() => { void reload(); }, []);
  const run = async (action: () => Promise<unknown>) => { setError(null); try { await action(); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Validator operation failed"); } };
  return <section aria-labelledby="validator-management-title">
    <h2 id="validator-management-title">Validator Management</h2>
    <p>Administrator-only lifecycle controls. Each mutation requires device fresh authentication and a confirmed blockchain receipt.</p>
    {error && <p role="alert">{error}</p>}
    <h3>Current validators</h3>
    <ul>{validators.map((validator) => <li key={validator.validatorId}>{validator.validatorId} — {validator.status} — tx {validator.txHash ?? "pending"}
      {validator.status === "REMOVED" && <button onClick={() => { if (window.confirm("Restore this validator with a new inverse transaction?")) void run(() => mockApi.restoreValidator(validator.registrationId, { reason: "Administrator recovery" })); }}>Restore Validator</button>}
      {validator.status === "ACTIVE" && <button onClick={() => { if (window.confirm("Schedule removal of this validator?")) void run(() => mockApi.removeValidator(validator.registrationId, { removalHeight: validator.activationHeight + 10, reason: "Administrator removal" })); }}>Remove Validator</button>}
    </li>)}</ul>
    <h3>Validator history</h3>
    <ol>{history.map((entry) => <li key={entry.historyId}>{entry.operation} — {entry.validatorId} — {entry.transactionHash ?? "unknown tx"} — {entry.actorIdentityId}</li>)}</ol>
    <button onClick={() => { const validatorId = window.prompt("Validator EVM address"); if (!validatorId) return; void run(() => mockApi.addValidator({ validatorId, nodeAddress: validatorId, publicKey: "public-key", signingPublicKey: "signing-key", activationHeight: 100 })); }}>Add Validator</button>
  </section>;
}
