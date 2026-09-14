// Shell tests: the login gate renders, and navigation is filtered by
// the same RBAC matrix the backend enforces. Person 6 should extend
// these per page rather than replace them.

import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";

describe("App shell", () => {
  it("shows the managed-device gate before sign-in", () => {
    render(<App />);
    expect(screen.getByText(/Managed-device session required/i)).toBeTruthy();
  });

  it("hides Employees from a non-admin role after sign-in", async () => {
    render(<App />);
    // The mock API seeds an ENGINEER session.
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(screen.getByText(/ENGINEER Dashboard/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Employees" })).toBeNull();
    expect(screen.getByRole("button", { name: "Assets" })).toBeTruthy();
  });

  it("navigates from the asset list into asset detail", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Assets" }));

    const row = await screen.findByRole("button", { name: /AST-001/ });
    await userEvent.click(row);

    await waitFor(() => expect(screen.getByText(/Custodian:/i)).toBeTruthy());
  });
});
