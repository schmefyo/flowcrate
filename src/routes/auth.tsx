import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Flowcrate" },
      {
        name: "description",
        content: "Sign in to Flowcrate — your personal music brain for capturing tracks, crates, and connections.",
      },
      { property: "og:title", content: "Sign in — Flowcrate" },
      {
        property: "og:description",
        content: "Sign in to Flowcrate — your personal music brain for capturing tracks, crates, and connections.",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&display=swap",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/tracks" });
    });
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: displayName },
          },
        });
        if (error) throw error;
        toast.success("Account created. You're in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      const { data } = await supabase.auth.getSession();
      if (data.session) navigate({ to: "/tracks" });
      else toast.info("Check your inbox to confirm your email.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      toast.error("Google sign-in failed");
    }
  }

  return (
    <div className="fc-auth flex min-h-screen items-center justify-center px-5 py-12 sm:px-8 sm:py-16">
      <div className="fc-auth-panel w-full max-w-sm border-y py-8 sm:py-10">
        <Link to="/" className="fc-auth-back">
          ← Flowcrate
        </Link>
        <p className="fc-auth-kicker mt-10">{mode === "signin" ? "Sign in" : "Sign up"}</p>
        <h1 className="fc-auth-title mt-4">
          {mode === "signin" ? "Welcome back" : "Create your account"}
        </h1>

        <p className="mt-5 max-w-sm leading-relaxed text-muted-foreground">
          {mode === "signin"
            ? "Pick up where you left off."
            : "Start saving tracks and building your music library."}
        </p>

        <form onSubmit={onSubmit} className="fc-auth-form mt-8 space-y-5 border-t pt-7">
          {mode === "signup" ? (
            <div className="space-y-2">
              <Label className="fc-auth-label" htmlFor="name">
                Display name
              </Label>
              <Input
                id="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label className="fc-auth-label" htmlFor="email">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="fc-auth-label" htmlFor="password">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy} className="fc-auth-primary w-full">
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <div className="fc-auth-divider my-7 flex items-center gap-3 text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          <span className="fc-auth-label">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button variant="outline" className="fc-auth-google w-full" onClick={google}>
          Continue with Google
        </Button>

        <button
          type="button"
          className="fc-auth-switch mt-7 w-full"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "No account yet? Sign up" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
