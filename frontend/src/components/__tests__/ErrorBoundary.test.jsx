import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorBoundary from "../ErrorBoundary";

function Bomb({ message = "boom" }) {
  throw new Error(message);
}

function Safe() {
  return <p>child content</p>;
}

function Toggleable({ shouldThrow, message }) {
  if (shouldThrow) throw new Error(message);
  return <p>child content</p>;
}

describe("ErrorBoundary", () => {
  let errorSpy;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("renders children when no error is thrown", () => {
    render(
      <ErrorBoundary>
        <Safe />
      </ErrorBoundary>
    );
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("renders fallback UI with error message when a child throws", () => {
    render(
      <ErrorBoundary>
        <Bomb message="database unreachable" />
      </ErrorBoundary>
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("database unreachable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("renders generic message when error has no message", () => {
    function NoMessageBomb() {
      throw new Error();
    }
    render(
      <ErrorBoundary>
        <NoMessageBomb />
      </ErrorBoundary>
    );
    expect(screen.getByText("An unexpected error occurred.")).toBeInTheDocument();
  });

  it("logs the caught error via console.error", () => {
    render(
      <ErrorBoundary>
        <Bomb message="logged failure" />
      </ErrorBoundary>
    );
    expect(errorSpy).toHaveBeenCalled();
    const loggedAsString = errorSpy.mock.calls.map((c) => c.join(" ")).join(" ");
    expect(loggedAsString).toContain("ErrorBoundary caught:");
  });

  it("Try again button recovers once the underlying fault is resolved", () => {
    function Harness() {
      const [broken, setBroken] = useState(true);
      return (
        <>
          <button onClick={() => setBroken(false)}>fix</button>
          <ErrorBoundary>
            <Toggleable shouldThrow={broken} message="first failure" />
          </ErrorBoundary>
        </>
      );
    }

    render(<Harness />);
    expect(screen.getByText("first failure")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "fix" }));
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(screen.getByText("child content")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });
});
