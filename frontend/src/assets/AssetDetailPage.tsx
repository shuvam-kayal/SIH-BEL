import { useEffect, useState } from "react";
import { can } from "../../../shared/rbac";
import { type AssetStatus } from "../../../shared/enums";
import type { Asset, AuthorizationGrant, User } from "../../../shared/types";
import { apiClient, HttpApiError } from "../api/client";
import { Badge, Button, Card, ErrorNotice, Loading, PageHead } from "../ui";

export function AssetDetailPage({ assetId, user, onViewAudit }: { assetId: string; user: User; onViewAudit?: (assetId: string) => void }) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const [componentId, setComponentId] = useState("");
  const [nextState, setNextState] = useState<AssetStatus | "">("");
  const [grantTarget, setGrantTarget] = useState("");
  const [grantExpiry, setGrantExpiry] = useState("");
  const [grants, setGrants] = useState<AuthorizationGrant[]>([]);
  const canManage = can(user.role, "REGISTER_ASSET");

  useEffect(() => {
    apiClient.getAsset(assetId).then((loaded) => {
      setAsset(loaded);
      setOwnerId(loaded?.ownerId ?? "");
      setNextState(loaded?.status === "ACTIVE" ? "IN_MAINTENANCE" : loaded?.status === "IN_MAINTENANCE" ? "ACTIVE" : "");
    }).catch((cause) => setError(cause instanceof HttpApiError && cause.status === 501 ? "Asset registry is not implemented by the backend yet." : cause instanceof Error ? cause.message : "Unable to load asset."));
  }, [assetId]);

  if (!asset && !error) return <Loading />;
  if (error && !asset) return <ErrorNotice message={error} />;
  if (!asset) return <ErrorNotice message="Asset not found." />;
  const currentAsset = asset;

  async function run(action: () => Promise<Asset>) {
    setError("");
    try { setAsset(await action()); } catch (cause) { setError(cause instanceof Error ? cause.message : "Asset operation failed."); }
  }
  async function transfer() { await run(() => apiClient.transferAsset(assetId, { newOwnerId: ownerId })); setEditing(false); }
  async function changeState() { if (nextState) await run(() => apiClient.changeAssetState(assetId, { newState: nextState })); }
  async function attach() { if (componentId.trim()) { await run(() => apiClient.attachComponent(assetId, { componentId: componentId.trim() })); setComponentId(""); } }
  async function detach() { if (currentAsset.parentAssetId) await run(() => apiClient.removeComponent(currentAsset.parentAssetId!, currentAsset.assetId)); }
  async function loadGrants() { if (!grantTarget.trim()) return; setError(""); try { setGrants(await apiClient.getGrants(grantTarget.trim())); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load transfer grants."); } }
  async function createGrant() { if (!grantTarget.trim()) return; setError(""); try { const grant = await apiClient.createTransferGrant(grantTarget.trim(), { resourceType: "ASSET", resourceId: assetId, action: "TRANSFER_ASSET", expiresAt: grantExpiry ? new Date(grantExpiry).toISOString() : null }); setGrants((current) => [grant, ...current]); setGrantExpiry(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create transfer grant."); } }
  async function revokeGrant(grant: AuthorizationGrant) { setError(""); try { const revoked = await apiClient.revokeGrant(grantTarget.trim(), grant.authorizationGrantId); setGrants((current) => current.map((item) => item.authorizationGrantId === revoked.authorizationGrantId ? revoked : item)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to revoke transfer grant."); } }

  const stateOptions = currentAsset.status === "ACTIVE" ? ["IN_MAINTENANCE", "DECOMMISSIONED"] : currentAsset.status === "IN_MAINTENANCE" ? ["ACTIVE", "DECOMMISSIONED"] : [];
  return <>
    <PageHead eyebrow="Asset registry" title={asset.assetId} description={`${asset.assetType} · NFT identity #${asset.nftId}`} action={<Badge tone={asset.status === "ACTIVE" ? "active" : "pending"}>{asset.status.replace("_", " ")}</Badge>} />
    {error && <ErrorNotice message={error} />}
    <div className="layout">
      <Card><h2>Asset identity</h2><div className="kv"><div className="k">Asset type</div><div className="v">{asset.assetType}</div><div className="k">NFT identity</div><div className="v">#{asset.nftId}</div><div className="k">Owner identity</div><div className="v mono">{asset.ownerId}</div><div className="k">Custodian identity</div><div className="v mono">{asset.custodianId}</div><div className="k">Parent asset</div><div className="v">{asset.parentAssetId || "Root asset"}</div></div><div className="actions" style={{ marginTop: 24 }}>{can(user.role, "VIEW_AUDIT_HISTORY") && <Button variant="secondary" onClick={() => onViewAudit?.(asset.assetId)}>View audit history</Button>}{can(user.role, "TRANSFER_ASSET") && <Button onClick={() => setEditing(!editing)}>Transfer asset</Button>}{asset.parentAssetId && canManage && <Button variant="secondary" onClick={() => void detach()}>Detach component</Button>}</div>{editing && <div className="notice" style={{ marginTop: 20 }}><div className="field"><label>New owner identity</label><input value={ownerId} onChange={(e) => setOwnerId(e.target.value)} /></div><div className="actions"><Button onClick={() => void transfer()}>Confirm transfer</Button><Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button></div></div>}</Card>
      <Card><h2>Lifecycle controls</h2><p className="muted">Ownership, lifecycle state, and component hierarchy are enforced by the backend and AssetRegistry.</p>{canManage && stateOptions.length > 0 && <div className="field"><label htmlFor="asset-state">Change state</label><select id="asset-state" value={nextState} onChange={(event) => setNextState(event.target.value as AssetStatus)}><option value="">Select state</option>{stateOptions.map((state) => <option key={state} value={state}>{state.replace("_", " ")}</option>)}</select><Button onClick={() => void changeState()} disabled={!nextState}>Apply state</Button></div>}{canManage && <div className="field" style={{ marginTop: 18 }}><label htmlFor="component-id">Attach component asset</label><input id="component-id" value={componentId} onChange={(event) => setComponentId(event.target.value)} placeholder="Component asset ID" /><Button onClick={() => void attach()} disabled={!componentId.trim()}>Attach component</Button></div>}{user.role === "ADMIN" && <div className="notice" style={{ marginTop: 18 }}><strong>Transfer authorization</strong><div className="field"><label htmlFor="grant-target">Target employee identity</label><input id="grant-target" value={grantTarget} onChange={(event) => setGrantTarget(event.target.value)} placeholder="Identity or employee ID" /></div><div className="field"><label htmlFor="grant-expiry">Expires at (optional)</label><input id="grant-expiry" type="datetime-local" value={grantExpiry} onChange={(event) => setGrantExpiry(event.target.value)} /></div><div className="actions"><Button onClick={() => void createGrant()} disabled={!grantTarget.trim()}>Create transfer grant</Button><Button variant="secondary" onClick={() => void loadGrants()} disabled={!grantTarget.trim()}>Load grants</Button></div>{grants.filter((grant) => grant.resourceId === assetId).map((grant) => <div className="small" key={grant.authorizationGrantId}>{grant.status} · {grant.expiresAt ? new Date(grant.expiresAt).toLocaleString("en-IN") : "No expiry"}{grant.status === "ACTIVE" && <Button variant="ghost" onClick={() => void revokeGrant(grant)}>Revoke</Button>}</div>)}</div>}{!canManage && <div className="notice success"><strong>Backend-controlled integrity</strong><br />Lifecycle and component changes require an authorized asset-management role.</div>}</Card>
    </div>
  </>;
}
