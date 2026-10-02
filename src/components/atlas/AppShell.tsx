import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/discover", label: "Discover" },
  { to: "/tracks", label: "Tracks" },
  { to: "/crates", label: "Crates" },
  { to: "/artists", label: "DJs & Artists" },
  { to: "/labels", label: "Labels" },
  { to: "/radar", label: "Radar" },
] as const;

export function AppShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string | undefined;
  action?: ReactNode | undefined;
  children: ReactNode;
}) {
  const navigate = useNavigate();

  return (
    <div className="fc-app">
      <header className="fc-masthead sticky top-0 z-30 border-b border-border">
        <div className="mx-auto flex max-w-[88rem] items-center gap-x-4 gap-y-2 px-3 py-3 sm:gap-x-6 sm:px-6 sm:py-4">
          <Link to="/" className="fc-wordmark shrink-0 text-primary">
            Flowcrate
          </Link>
          <nav className="-mx-1 flex flex-1 items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="fc-nav-link shrink-0 whitespace-nowrap px-2 py-2 text-muted-foreground transition-colors sm:px-3"
                activeProps={{ className: "fc-nav-link-active" }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/" });
            }}
          >
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-[88rem] px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6 sm:mb-10">
          <div>
            <h1 className="fc-page-title">{title}</h1>
            {subtitle ? <p className="mt-3 text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          {action}
        </div>
        {children}
      </main>
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="fc-empty-state border border-border p-12 text-center text-muted-foreground">
      {text}
    </div>
  );
}
