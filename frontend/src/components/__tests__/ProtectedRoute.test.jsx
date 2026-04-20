import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ProtectedRoute from "../ProtectedRoute";

const mockUseAuth = vi.fn();

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("react-router-dom", () => ({
  Navigate: ({ to, replace }) => (
    <div data-testid="navigate" data-to={to} data-replace={String(!!replace)} />
  ),
}));

describe("ProtectedRoute", () => {
  it("shows loader while auth state is resolving", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true });
    const { container } = render(
      <ProtectedRoute>
        <p>secret</p>
      </ProtectedRoute>
    );
    expect(container.querySelector("svg.animate-spin")).toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("redirects to /login when user is not authenticated", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    render(
      <ProtectedRoute>
        <p>secret</p>
      </ProtectedRoute>
    );
    const nav = screen.getByTestId("navigate");
    expect(nav.getAttribute("data-to")).toBe("/login");
    expect(nav.getAttribute("data-replace")).toBe("true");
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("renders children when user is authenticated", () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1", email: "t@t.com" }, loading: false });
    render(
      <ProtectedRoute>
        <p>secret</p>
      </ProtectedRoute>
    );
    expect(screen.getByText("secret")).toBeInTheDocument();
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
  });
});
