"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useId, useState } from "react";
import { Wordmark } from "@/components/ui/chrome";
import { Spinner } from "@/components/ui/primitives";

export default function LoginPage() {
  const router = useRouter();
  const passwordId = useId();
  const errorId = useId();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace("/dashboard");
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Login failed.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <form onSubmit={onSubmit} className="surface anim-in w-full max-w-[340px] p-6">
        <Wordmark />
        <p className="t-body mt-3 text-ink-2">
          AI presentations and documents, generated entirely on this machine.
        </p>

        <label htmlFor={passwordId} className="t-label mb-1.5 mt-6 block text-ink-2">
          Password
        </label>
        <input
          id={passwordId}
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError(null);
          }}
          autoFocus
          autoComplete="current-password"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="input"
        />
        {error && (
          <p id={errorId} role="alert" className="t-caption mt-2 text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="btn btn-primary btn-lg mt-5 w-full"
        >
          {busy && <Spinner />}
          {busy ? "Signing in…" : "Continue"}
        </button>
      </form>
    </main>
  );
}
