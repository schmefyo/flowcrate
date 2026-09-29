import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import heroImage from "@/assets/hero-club.jpg";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FlowCrate" },
      {
        name: "description",
        content:
          "FlowCrate is your personal music brain—capture what you discover, organize it by mood, energy, and context, and follow the connections to find what's next.",
      },
      { property: "og:title", content: "FlowCrate" },
      {
        property: "og:description",
        content:
          "FlowCrate is your personal music brain—capture what you discover, organize it by mood, energy, and context, and follow the connections to find what's next.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    kicker: "01 / Tracks",
    title: "Save what moves you",
    body: "Artist, label, BPM, key, mood tags and an energy rating — every record you dig up, searchable in seconds.",
  },
  {
    kicker: "02 / Crates",
    title: "Crates for every mood",
    body: "Group tracks by feeling, room or hour of the night. Openers, peak-time weapons, and late-night energy.",
  },
  {
    kicker: "03 / Labels",
    title: "Follow the crews",
    body: "Follow labels, collectives, and parties, where they come from and the tracks they gave you.",
  },
  {
    kicker: "04 / Discover",
    title: "Find what comes next",
    body: "See which DJs play your tracks, find sets that match your crates, and fill the gaps with what comes next.",
  },
];

function Landing() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
  }, []);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
        <span className="label-mono text-primary">FLOWCRATE</span>
        <Button variant="ghost" size="sm" asChild>
          <Link to={signedIn ? "/tracks" : "/auth"}>{signedIn ? "Open FlowCrate" : "Sign in"}</Link>
        </Button>
      </header>

      <section className="relative overflow-hidden border-y border-border">
        <img
          src={heroImage}
          alt="Blurred silhouettes dancing in a basement club under green and magenta light"
          width={1600}
          height={912}
          className="absolute inset-0 h-full w-full object-cover opacity-45"
        />
        <div className="relative mx-auto max-w-6xl px-5 py-28 sm:py-40">
          <p className="label-mono text-accent">FOR DJS, DIGGERS, & OBSESSIVE LISTENERS</p>
          <h1 className="mt-6 max-w-3xl text-5xl font-bold leading-[1.05] sm:text-7xl">
            Know your music. <span className="text-gradient-acid">Find what's next.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            FlowCrate is your personal music brain. Capture what you discover, organize it by mood,
            energy, and context, and follow the connections to find what's next.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link to={signedIn ? "/tracks" : "/auth"}>
                {signedIn ? "Open FlowCrate" : "Start Building Your Crate →"}
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-24">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <article key={f.kicker} className="rounded-md border border-border bg-card p-6">
              <p className="label-mono text-primary">{f.kicker}</p>
              <h2 className="mt-3 text-xl font-semibold">{f.title}</h2>
              <p className="mt-3 text-sm text-muted-foreground">{f.body}</p>
            </article>
          ))}
        </div>

        <p className="mt-16 max-w-2xl text-sm text-muted-foreground">
          Next: log the sets you hear, track your own practice sessions, and
          map the connections between artists, labels, and generations. This first slice is the
          collection — the rest is the world around it.
        </p>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-5 py-8 label-mono text-muted-foreground">
          Built for the dancefloor · everything you save is private to you
        </div>
      </footer>
    </div>
  );
}
