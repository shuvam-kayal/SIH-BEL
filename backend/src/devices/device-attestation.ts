/**
 * Platform seam for managed-device and BEL-network attestation.
 *
 * The request metadata is evidence only. Implementations must obtain the
 * security decision from a trusted device-management/VPN integration rather
 * than accepting client-supplied managedDevice or network flags.
 */
export type DeviceAttestationRequest = {
  deviceId: string;
  metadata: Record<string, unknown>;
};

export type DeviceAttestationResult = {
  verified: boolean;
  managedDevice: boolean;
  networkApproved: boolean;
  evidence?: Record<string, unknown>;
};

/** Production integration seam. A real BEL MDM/VPN provider implements this
 * interface; the backend never treats request metadata as attestation. */
export interface ManagedDeviceAttestationProvider {
  attest(request: DeviceAttestationRequest): Promise<DeviceAttestationResult>;
}

export interface DeviceAttestationAdapter extends ManagedDeviceAttestationProvider {}

/** Default-safe adapter: onboarding is unavailable until a real integration
 * is configured. It never trusts client metadata. */
export class RejectingDeviceAttestationAdapter implements DeviceAttestationAdapter {
  async attest(_request: DeviceAttestationRequest): Promise<DeviceAttestationResult> {
    return { verified: false, managedDevice: false, networkApproved: false, evidence: { adapter: "unconfigured" } };
  }
}

/** Explicit fail-closed production placeholder until BEL supplies a provider. */
export class NotConfiguredManagedDeviceAttestationProvider extends RejectingDeviceAttestationAdapter {}

/** Deterministic test adapter. Approval is configured out-of-band by the
 * test, and request metadata is intentionally ignored. */
export class MockDeviceAttestationAdapter implements DeviceAttestationAdapter {
  private readonly approvedDeviceIds: Set<string>;

  constructor(approvedDeviceIds: readonly string[] = []) {
    this.approvedDeviceIds = new Set(approvedDeviceIds);
  }

  approve(deviceId: string): void { this.approvedDeviceIds.add(deviceId); }

  async attest(request: DeviceAttestationRequest): Promise<DeviceAttestationResult> {
    const approved = this.approvedDeviceIds.has(request.deviceId);
    return {
      verified: approved,
      managedDevice: approved,
      networkApproved: approved,
      evidence: { adapter: "mock", deviceId: request.deviceId, decision: approved ? "approved" : "denied" },
    };
  }
}
