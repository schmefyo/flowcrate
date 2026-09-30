import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import heroImage from "@/assets/hero-club.jpg";
import landingCss from "@/components/landing/landing.css?url";
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
    links: [
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&display=swap",
      },
      { rel: "stylesheet", href: landingCss },
    ],
  }),
  component: Landing,
});

const FLOW = [
  {
    pos: "A1",
    title: "Discover",
    body: "Start anywhere — a DJ whose taste you trust, a mix you can't stop replaying, a record already in your bag. Discover and Radar surface what's moving around the music you care about.",
    where: "Discover · Radar",
  },
  {
    pos: "A2",
    title: "Follow",
    body: "Every track connects to the artists who made it, the labels that released it and the DJs who play it. Pull on any of those threads and see where it leads.",
    where: "DJs & Artists · Labels",
  },
  {
    pos: "B1",
    title: "Save",
    body: "Keep what stops you in your tracks. Artist, release, label, BPM and key come attached where available, along with the mixes it has turned up in.",
    where: "Tracks",
  },
  {
    pos: "B2",
    title: "Crate",
    body: "Sort your finds by sound, scene, label, era or feeling. Some crates stay personal archives — and some, eventually, become sets.",
    where: "Crates · Sets, later",
  },
];

// seenInSets values are illustrative, not real counts.
const EXAMPLE_CRATE = [
  {
    artist: "Joey Beltram",
    title: "Energy Flash",
    label: "R&S Records",
    year: 1990,
    bpm: 123,
    key: "4B",
    seenInSets: 29,
  },
  {
    artist: "Plastikman",
    title: "Spastik",
    label: "NovaMute / Plus 8",
    year: 1993,
    bpm: 126,
    key: "5B",
    seenInSets: 24,
  },
  {
    artist: "Basic Channel",
    title: "Phylyps Trak",
    label: "Basic Channel",
    year: 1993,
    bpm: 144,
    key: "6A",
    seenInSets: 14,
  },
  {
    artist: "Dave Clarke",
    title: "Wisdom To The Wise (Red 2)",
    label: "Bush",
    year: 1994,
    bpm: 143,
    key: "4A",
    seenInSets: 19,
  },
  {
    artist: "Green Velvet",
    title: "Flash",
    label: "Relief Records",
    year: 1995,
    bpm: 128,
    key: "7A",
    seenInSets: 22,
  },
  {
    artist: "Jeff Mills",
    title: "The Bells",
    label: "Purpose Maker",
    year: 1996,
    bpm: 138,
    key: "8A",
    seenInSets: 32,
  },
  {
    artist: "DJ Rolando",
    title: "Knights of the Jaguar",
    label: "Underground Resistance",
    year: 1999,
    bpm: 138,
    key: "7A",
    seenInSets: 27,
  },
];

const FEATURES = [
  {
    no: "01",
    kicker: "Tracks",
    title: "Save what moves you",
    body: "Artist, label, BPM, key, mood tags and an energy rating — every record you dig up, searchable in seconds.",
  },
  {
    no: "02",
    kicker: "Crates",
    title: "Crates for every mood",
    body: "Group tracks by feeling, room or hour of the night. Openers, peak-time weapons, and late-night energy.",
  },
  {
    no: "03",
    kicker: "Labels",
    title: "Follow the crews",
    body: "Follow labels, collectives, and parties, where they come from and the tracks they gave you.",
  },
  {
    no: "04",
    kicker: "Discover",
    title: "Find what comes next",
    body: "See which DJs play your tracks, follow the artists and labels around them, and keep digging.",
  },
];

const SCENES = [
  "Techno",
  "Electro",
  "Dub techno",
  "Breaks",
  "UK garage",
  "Deep house",
  "EBM",
  "Ambient",
  "Minimal",
  "Jungle",
  "Acid",
  "Leftfield",
];

function Landing() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
  }, []);

  const entry = signedIn ? "/tracks" : "/auth";

  return (
    <div className="fc-landing">
      <header className="fc-rule border-b">
        <div className="mx-auto flex max-w-[88rem] items-center justify-between gap-6 px-5 py-4 sm:px-8">
          <Link to="/" className="flex items-baseline gap-3">
            <span className="fc-display text-xl tracking-[-0.02em]">Flowcrate</span>
            <span className="fc-mono fc-faint hidden sm:inline">FC—001</span>
          </Link>
          <Link to={entry} className="fc-link">
            {signedIn ? "Open FlowCrate" : "Sign in"}
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-[88rem] px-5 pt-10 sm:px-8 sm:pt-14">
          <p className="fc-mono fc-dim fc-rule border-b pb-4">
            For DJs, diggers & obsessive listeners
          </p>

          <h1 className="fc-display mt-8 text-[clamp(3.1rem,11.6vw,11.5rem)] sm:mt-10">
            Dig deeper.
            <br />
            Save what
            <br />
            you <span className="fc-outline">find.</span>
          </h1>

          <div className="mt-12 grid gap-10 pb-16 lg:grid-cols-12 lg:gap-8 lg:pb-24">
            <div className="flex flex-col gap-10 lg:col-span-4">
              <p className="max-w-md text-lg leading-relaxed text-[var(--fc-dim)]">
                <span className="text-[var(--fc-paper)]">
                  FlowCrate is your personal music brain.
                </span>{" "}
                Follow the links between artists, labels, DJs and scenes, keep what you find, and
                sort it in a way that makes sense to you.
              </p>
              <div>
                <Link to={entry} className="fc-btn">
                  {signedIn ? "Open FlowCrate" : "Start building your crate"}
                  <span aria-hidden className="fc-btn-arrow">
                    →
                  </span>
                </Link>
              </div>
              <ol className="fc-rule mt-auto hidden border-t lg:block">
                {FLOW.map((item) => (
                  <li
                    key={item.pos}
                    className="fc-rule flex items-baseline justify-between gap-4 border-b py-2.5"
                  >
                    <span className="flex items-baseline gap-4">
                      <span className="fc-mono fc-coral">{item.pos}</span>
                      <span className="fc-condensed text-lg">{item.title}</span>
                    </span>
                    <span className="fc-mono fc-faint text-right">
                      {item.where.split(" · ")[0]}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <figure className="lg:col-span-8">
              <div className="fc-duotone aspect-[16/9]">
                <img
                  src={heroImage}
                  alt="Blurred silhouettes dancing in a basement club under green and magenta light"
                  width={1600}
                  height={912}
                  className="h-full w-full object-cover"
                />
              </div>
              <figcaption className="fc-mono fc-faint fc-rule mt-3 flex justify-between gap-4 border-t pt-3">
                <span>Fig. 01 — Basement, 04:12</span>
                <span>Where the good records come from</span>
              </figcaption>
            </figure>
          </div>
        </section>

        <div className="fc-rule overflow-hidden border-y py-3" aria-hidden>
          <div className="fc-ticker">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex shrink-0">
                {SCENES.map((scene) => (
                  <span
                    key={scene}
                    className="fc-condensed fc-dim flex items-center text-2xl sm:text-3xl"
                  >
                    <span className="px-6">{scene}</span>
                    <span className="fc-coral text-base">✕</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        <section className="mx-auto max-w-[88rem] px-5 py-20 sm:px-8 sm:py-28">
          <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
            <div className="min-w-0 lg:col-span-4">
              <p className="fc-mono fc-coral">How digging works · Side A / Side B</p>
              <h2 className="fc-display mt-5 text-[clamp(2.4rem,10vw,3.75rem)]">
                One record
                <br />
                leads to
                <br />
                the next.
              </h2>
            </div>
            <p className="max-w-lg self-end text-lg leading-relaxed text-[var(--fc-dim)] lg:col-span-6 lg:col-start-7">
              Digging starts loose — a track ID from a mix, a label someone mentioned, a DJ you keep
              coming back to. FlowCrate follows where it leads and keeps hold of what you find.
            </p>
          </div>

          <ol className="fc-rule mt-14 border-t">
            {FLOW.map((item) => (
              <li
                key={item.pos}
                className="fc-side-row fc-rule grid gap-4 border-b py-8 md:grid-cols-12 md:items-baseline md:gap-8 md:py-10"
              >
                <span className="fc-side-pos fc-mono fc-faint text-sm md:col-span-1">
                  {item.pos}
                </span>
                <h3 className="fc-display text-[clamp(2.75rem,4.6vw,4.5rem)] md:col-span-5">
                  {item.title}
                </h3>
                <p className="max-w-xl leading-relaxed text-[var(--fc-dim)] md:col-span-4">
                  {item.body}
                </p>
                <span className="fc-mono fc-faint md:col-span-2 md:text-right">{item.where}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="fc-rule border-t bg-[var(--fc-ink-2)]">
          <div className="mx-auto grid max-w-[88rem] gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-12 lg:gap-8">
            <div className="min-w-0 lg:col-span-4">
              <p className="fc-mono fc-coral">Inside a crate</p>
              <h2 className="fc-display mt-5 text-[clamp(2.4rem,10vw,3.75rem)]">
                Every record
                <br />
                keeps its
                <br />
                context.
              </h2>
              <p className="mt-8 max-w-sm leading-relaxed text-[var(--fc-dim)]">
                Where available, tracks carry their artist, release, label and year — and the links
                out to everything around them. Your library remembers where things came from, not
                just what they're called.
              </p>
            </div>

            <div className="min-w-0 lg:col-span-8">
              <div className="fc-rule border bg-[var(--fc-ink)]">
                <div className="fc-rule flex flex-wrap items-baseline justify-between gap-3 border-b px-5 py-4">
                  <div className="flex items-baseline gap-4">
                    <span className="fc-mono fc-faint">Crate</span>
                    <span className="fc-condensed text-2xl">90s Techno / Essentials</span>
                  </div>
                  <span className="fc-mono fc-faint">
                    {EXAMPLE_CRATE.length} records · 1990–1999
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left sm:min-w-[46rem]">
                    <thead>
                      <tr className="fc-mono fc-faint fc-rule border-b">
                        <th className="px-5 py-3 font-normal">#</th>
                        <th className="py-3 pr-4 font-normal">Track</th>
                        <th className="hidden py-3 pr-4 font-normal sm:table-cell">Label</th>
                        <th className="hidden py-3 pr-4 text-right font-normal sm:table-cell">
                          Year
                        </th>
                        <th className="hidden py-3 pr-4 text-right font-normal sm:table-cell">
                          BPM
                        </th>
                        <th className="hidden py-3 pr-4 text-right font-normal sm:table-cell">
                          Key
                        </th>
                        <th className="py-3 pr-5 text-right font-normal">Seen in sets</th>
                      </tr>
                    </thead>
                    <tbody>
                      {EXAMPLE_CRATE.map((t, i) => (
                        <tr key={t.title} className="fc-crate-row fc-rule border-b last:border-b-0">
                          <td className="fc-mono fc-faint px-5 py-4 align-top">
                            {String(i + 1).padStart(2, "0")}
                          </td>
                          <td className="py-4 pr-4">
                            <div className="font-semibold">{t.title}</div>
                            <div className="text-sm text-[var(--fc-dim)]">{t.artist}</div>
                            <div className="fc-mono fc-faint mt-2 space-y-1 sm:hidden">
                              <div>{t.label}</div>
                              <div>
                                {t.year} · {t.bpm} BPM · {t.key}
                              </div>
                            </div>
                          </td>
                          <td className="fc-mono fc-dim hidden py-4 pr-4 sm:table-cell">
                            {t.label}
                          </td>
                          <td className="fc-num hidden py-4 pr-4 text-right sm:table-cell">
                            {t.year}
                          </td>
                          <td className="fc-num hidden py-4 pr-4 text-right sm:table-cell">
                            {t.bpm}
                          </td>
                          <td className="fc-num hidden py-4 pr-4 text-right sm:table-cell">
                            {t.key}
                          </td>
                          <td className="py-4 pr-5">
                            <div className="flex justify-end">
                              <SetMeter count={t.seenInSets} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="fc-rule border-t">
          <div className="mx-auto max-w-[88rem] px-5 py-20 sm:px-8 sm:py-28">
            <p className="fc-mono fc-coral">Liner notes</p>
            <div className="mt-10 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((f) => (
                <article key={f.no} className="fc-rule border-t pt-5">
                  <p className="fc-mono fc-faint">
                    {f.no} / {f.kicker}
                  </p>
                  <h3 className="fc-condensed mt-4 text-3xl leading-none">{f.title}</h3>
                  <p className="mt-4 leading-relaxed text-[var(--fc-dim)]">{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="fc-rule border-t">
          <div className="mx-auto grid max-w-[88rem] gap-14 px-5 py-20 sm:px-8 sm:py-32 lg:grid-cols-12 lg:gap-8">
            <div className="min-w-0 lg:col-span-8">
              <p className="fc-mono fc-dim">Follow the thread</p>
              <h2 className="fc-display mt-6 text-[clamp(3.4rem,10vw,9rem)]">
                Keep
                <br />
                <span className="fc-coral">digging.</span>
              </h2>
            </div>

            <div className="flex min-w-0 flex-col gap-10 self-end lg:col-span-4">
              <p className="max-w-md leading-relaxed text-[var(--fc-dim)]">
                Every record points somewhere else — another artist, another label, another city,
                another scene. FlowCrate helps you keep following.
              </p>
              <div>
                <Link to={entry} className="fc-btn">
                  {signedIn ? "Open FlowCrate" : "Start digging"}
                  <span aria-hidden className="fc-btn-arrow">
                    →
                  </span>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="fc-rule border-t">
        <div className="fc-mono fc-faint mx-auto flex max-w-[88rem] flex-wrap justify-between gap-3 px-5 py-6 sm:px-8">
          <span>Built for the dancefloor · everything you save is private to you</span>
          <span>FlowCrate — independent, in active development</span>
        </div>
      </footer>
    </div>
  );
}

function SetMeter({ count }: { count: number }) {
  const lit = Math.min(8, Math.ceil(count / 4));
  return (
    <span className="fc-meter" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <span
          key={i}
          style={{ height: `${40 + i * 8}%` }}
          {...(i < lit ? { "data-on": "" } : {})}
        />
      ))}
    </span>
  );
}
