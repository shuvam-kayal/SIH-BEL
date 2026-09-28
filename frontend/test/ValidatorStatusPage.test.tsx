import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ValidatorStatusPage } from "../src/validators/ValidatorStatusPage";
import { apiClient } from "../src/api/client";

const status = { height: 7037, lastFinalizedHeight: 7037, finalityLag: 0, healthy: true };
const validator = { validatorId: "0x1111111111111111111111111111111111111111", publicKey: `0x${"ab".repeat(64)}`, status: "ACTIVE" as const, joinedAt: "2026-09-10T12:30:00Z" };

afterEach(() => { vi.restoreAllMocks(); });

describe("ValidatorStatusPage network capability states", () => {
  it("shows each healthy signal when all calls succeed", async () => {
    vi.spyOn(apiClient, "getBlockchainStatus").mockResolvedValue(status);
    vi.spyOn(apiClient, "getValidators").mockResolvedValue([validator]);
    vi.spyOn(apiClient, "getCommittee").mockResolvedValue({ height: 7037, validatorIds: [validator.validatorId] });
    render(<ValidatorStatusPage />);
    await waitFor(() => expect(screen.getAllByText("HEALTHY").length).toBeGreaterThanOrEqual(5));
    expect(screen.getByText(validator.validatorId)).toBeTruthy();
  });

  it("does not claim overall health or invent validators when consensus RPCs fail", async () => {
    vi.spyOn(apiClient, "getBlockchainStatus").mockResolvedValue(status);
    vi.spyOn(apiClient, "getValidators").mockRejectedValue(new Error("bel_getValidators RPC request failed"));
    vi.spyOn(apiClient, "getCommittee").mockRejectedValue(new Error("bel_getCommittee RPC request failed"));
    render(<ValidatorStatusPage />);
    await waitFor(() => expect(screen.getAllByText("UNAVAILABLE").length).toBe(2));
    expect(screen.queryByText("HEALTHY", { selector: ".badge" })).toBeTruthy();
    expect(screen.queryByText(/0x1111/)).toBeNull();
    expect(screen.getByText("Committee data is unavailable from the configured network RPC.")).toBeTruthy();
    expect(screen.getByText("Validator data is unavailable from the configured network RPC.")).toBeTruthy();
  });
});
