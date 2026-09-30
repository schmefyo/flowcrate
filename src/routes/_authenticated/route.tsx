import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  head: () => ({
    links: [
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&display=swap",
      },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: () => <Outlet />,
});
