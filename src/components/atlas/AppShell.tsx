import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/tracks", label: "Tracks" },
  { to: "/crates", label: "Crates" },
  { to: "/artists", label: "DJs & Artists" },
  { to: "/labels", label: "Labels" },
  { to: "/discover", label: "Discover" },
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
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-x-4 gap-y-2 px-3 py-2 sm:gap-x-6 sm:px-5 sm:py-3">
          <Link to="/" className="label-mono shrink-0 text-primary">
            FlowCrate
          </Link>
          <nav className="-mx-1 flex flex-1 items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="shrink-0 whitespace-nowrap rounded-sm px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:px-3"
                activeProps={{ className: "bg-secondary text-foreground" }}
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

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3 sm:mb-8 sm:gap-4">
          <div>
            <h1 className="text-2xl font-bold sm:text-4xl">{title}</h1>
            {subtitle ? <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p> : null}
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
    <div className="rounded-md border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
