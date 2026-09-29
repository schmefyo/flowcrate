export type CategoryMember = { title: string; pageid?: number; timestamp?: string };

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function categoryResponse(members: CategoryMember[], continuation?: string) {
  return {
    query: {
      categorymembers: members.map((member, index) => ({ pageid: index + 1, ...member })),
    },
    ...(continuation ? { continue: { cmcontinue: continuation } } : {}),
  };
}

export function categoryInfoResponse(size: number) {
  return { query: { pages: { "1": { categoryinfo: { size } } } } };
}

export function revisionsResponse(entries: Record<string, string | undefined>) {
  return {
    query: {
      pages: Object.fromEntries(
        Object.entries(entries).map(([title, content], index) => [
          String(index + 1),
          {
            pageid: index + 1,
            title,
            ...(content === undefined
              ? {}
              : {
                  revisions: [
                    {
                      revid: index + 100,
                      timestamp: "2026-01-01T00:00:00Z",
                      slots: { main: { "*": content } },
                    },
                  ],
                }),
          },
        ]),
      ),
    },
  };
}

export function revisionPagesResponse(
  entries: { pageId: number; title: string; content: string | undefined }[],
) {
  return {
    query: {
      pages: Object.fromEntries(
        entries.map(({ pageId, title, content }) => [
          String(pageId),
          {
            pageid: pageId,
            title,
            ...(content === undefined
              ? {}
              : {
                  revisions: [
                    {
                      revid: pageId + 100,
                      timestamp: "2026-01-01T00:00:00Z",
                      slots: { main: { "*": content } },
                    },
                  ],
                }),
          },
        ]),
      ),
    },
  };
}

export function requestParams(input: RequestInfo | URL): URLSearchParams {
  return new URL(typeof input === "string" ? input : input.toString()).searchParams;
}
