import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";

afterEach(() => {
  cleanup();
});

async function signInAs(employeeId: string) {
  await userEvent.type(
    screen.getByPlaceholderText("Example: EMP001"),
    employeeId
  );
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("App shell", () => {
  it("shows the sign-in page before sign-in", () => {
    render(<App />);

    expect(
      screen.getByText(/Sign in using your assigned Employee ID/i)
    ).toBeTruthy();
  });

  it("hides Employees from a non-admin role after sign-in", async () => {
    render(<App />);
    await signInAs("EMP001");

    expect(await screen.findByRole("button", { name: "Assets" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Employees" })).toBeNull();
  });

  it("navigates from the asset list into asset detail", async () => {
    render(<App />);
    await signInAs("EMP001");

    await userEvent.click(
      await screen.findByRole("button", { name: "Assets" })
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /view details/i })
    );

    expect(
      await screen.findByText(/Asset details and ownership/i)
    ).toBeTruthy();
  });
});