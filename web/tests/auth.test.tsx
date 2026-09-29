import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  getSupabase: () => ({ auth: { signInWithOtp, verifyOtp } }),
}));

import { SignIn } from "@/features/auth/SignIn";

describe("SignIn", () => {
  beforeEach(() => {
    signInWithOtp.mockReset();
    verifyOtp.mockReset();
  });

  it("never creates unknown users and keeps request feedback generic", async () => {
    signInWithOtp.mockResolvedValue({ error: new Error("User not found") });
    render(<SignIn configured />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "Reviewer@Example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));

    await waitFor(() =>
      expect(signInWithOtp).toHaveBeenCalledWith({
        email: "reviewer@example.com",
        options: { shouldCreateUser: false },
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("If this email is authorized");
  });

  it("submits an eight-digit email OTP", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    verifyOtp.mockResolvedValue({ error: null });
    render(<SignIn configured />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "reviewer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));
    const codeInput = await screen.findByLabelText("Eight-digit code");
    expect(codeInput).toHaveAttribute("placeholder", "00000000");
    expect(codeInput).toHaveAttribute("maxLength", "8");
    fireEvent.change(codeInput, { target: { value: "12345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));

    await waitFor(() =>
      expect(verifyOtp).toHaveBeenCalledWith({
        email: "reviewer@example.com",
        token: "12345678",
        type: "email",
      }),
    );
  });

  it("accepts pasted OTP text and keeps only eight digits", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    render(<SignIn configured />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "reviewer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));
    const codeInput = await screen.findByLabelText("Eight-digit code");
    fireEvent.change(codeInput, { target: { value: "12 34-56a78" } });
    expect(codeInput).toHaveValue("12345678");
    expect(screen.getByRole("button", { name: "Open workspace" })).toBeEnabled();
  });
});
