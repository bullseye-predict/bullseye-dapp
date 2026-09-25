import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  broadcastBelongsToMatch,
  matchClock,
  MatchViewer,
} from "../src/components/home/MatchViewer";
import { InteractionConsole } from "../src/components/home/InteractionConsole";
import { unpricedMarkets } from "../src/components/home/useVenueMarketPrices";
import { createSolzDataSource } from "../src/components/solz/solzDataSource";
import { LiveMatches, NextMatches } from "../src/components/home/CommunitySections";
import {
  OpenDreamDexMarket,
  readMarketCreationResponse,
} from "../src/components/home/OpenDreamDexMarket";

describe("highlight livestream navigation", () => {
  test("configured YouTube livestream overrides the match stream, with an empty-config fallback", async () => {
    const source = createSolzDataSource();
    const snapshot = await source.load();
    const match = { ...snapshot.matches.find(item => item.id === snapshot.highlightMatchId)!, streamUrl: "https://stream.example/match.m3u8" };
    const markets = snapshot.markets.filter(item => item.matchId === match.id);
    const market = markets[0];
    const render = (livestreamUrl: string) => renderToStaticMarkup(
      <MatchViewer match={match} market={market} markets={markets} snapshot={snapshot}
        source={source} view="live" onView={() => {}} outcome={market.outcomes[0]}
        onSelect={() => {}} liveHref="/live" onChat={() => {}} onPrompt={() => {}}
        livestreamUrl={livestreamUrl} />,
    );
    const youtube = render("https://www.youtube.com/watch?v=P789IWNRQso");
    expect(youtube).toContain("https://www.youtube-nocookie.com/embed/P789IWNRQso?autoplay=1&amp;mute=1&amp;playsinline=1&amp;rel=0");
    expect(youtube).toContain('class="sh-broadcast-image sh-broadcast-youtube"');
    expect(youtube).not.toContain("<video");
    expect(render("")).toContain("<video");
  });

  test("clamps fixed-duration elapsed time and supports open-ended modes", () => {
    expect(
      matchClock(
        {
          startedAt: 0,
          endsAt: 1_200_000,
          durationMs: 1_200_000,
          timingType: "countdown",
        },
        1_314_000,
      ),
    ).toEqual({ elapsedMs: 1_200_000, remainingMs: 0, durationMs: 1_200_000 });
    expect(
      matchClock(
        {
          startedAt: 0,
          endsAt: Number.MAX_SAFE_INTEGER,
          timingType: "open-ended",
        },
        1_314_000,
      ),
    ).toEqual({ elapsedMs: 1_314_000, remainingMs: null, durationMs: null });
  });

  test("accepts broadcast state only for the exact Elysia match identity", () => {
    const match = {
      id: "arena-534f4c5a01010014000000006aa450c04c23a94f97535c9ce00ab537d71d1588",
      roomId: "eb071aa4-c50a-4fa8-92fe-5b4428b20d42",
      displayMatchId: "GM-DM_DR-20_TS-1789153472_ID-D71D1588",
    };
    expect(
      broadcastBelongsToMatch(
        "0x534f4c5a01010014000000006aa450c04c23a94f97535c9ce00ab537d71d1588",
        match,
      ),
    ).toBe(true);
    expect(broadcastBelongsToMatch("another-match", match)).toBe(false);
    expect(broadcastBelongsToMatch(null, match)).toBe(false);
  });

  test("paginates authoritative live matches after ten rows", () => {
    const matches = Array.from({ length: 11 }, (_, index) => ({
      id: `MATCH ${index + 1}`,
      region: "Configured arena",
      phase: "live" as const,
      mode: "DEATHMATCH",
      players: 12,
      capacity: 12,
      spectators: 0,
      startedAt: 1,
      watchUrl: "/watch",
    }));
    const html = renderToStaticMarkup(
      <LiveMatches feed={{ matches, loading: false, error: "" }} />,
    );
    expect(html).toContain("MATCH 10");
    expect(html).not.toContain("MATCH 11");
    expect(html).toContain(">Next</button>");
    expect(html).toContain("1 / 2");
  });

  test("shows a preparation state during breaks and handles an HTML service error clearly", async () => {
    const html = renderToStaticMarkup(
      <OpenDreamDexMarket
        apiUrl="/api/prediction"
        eventId="match"
        agentId="genesis-01"
        preparing
        onOpened={() => {}}
      />,
    );
    expect(html).toContain("BREAK TIME");
    expect(html).toContain("PREPARING MATCH SYSTEM");
    expect(html).not.toContain("Open market");
    await expect(
      readMarketCreationResponse(
        new Response("<!doctype html>", {
          status: 404,
          headers: { "content-type": "text/html" },
        }),
      ),
    ).rejects.toThrow("Sponsored market creation is unavailable (404).");
  });
  for (const state of ["match", "intermission", "pinned-season"] as const) {
    test(`keeps the livestream tab and panel available during ${state}`, async () => {
      const source = createSolzDataSource();
      const snapshot = await source.load();
      const match = snapshot.matches.find(
        (item) => item.id === snapshot.highlightMatchId,
      )!;
      const season = state !== "match";
      if (state === "intermission") match.phase = "settled";
      const markets = snapshot.markets.filter((item) =>
        season ? !item.matchId : item.matchId === match.id,
      );
      const market = markets[0];
      for (const view of ["live", "market", "options"] as const) {
        const html = renderToStaticMarkup(
          <MatchViewer
            match={match}
            market={market}
            markets={markets}
            snapshot={snapshot}
            source={source}
            view={view}
            onView={() => {}}
            outcome={market.outcomes[0]}
            onSelect={() => {}}
            liveHref="/live"
            onChat={() => {}}
            onPrompt={() => {}}
            season={season}
          />,
        );
        const tab = html.match(
          /<button[^>]*id="highlight-view-live-tab"[^>]*>/,
        )?.[0];
        expect(tab).toBeDefined();
        expect(tab).toContain(`aria-selected="${view === "live"}"`);
        expect(tab).not.toContain("disabled");
        const panel = html.match(
          /<div[^>]*id="highlight-view-live-panel"[^>]*>/,
        )?.[0];
        expect(panel).toBeDefined();
        expect(panel?.includes("hidden")).toBe(view !== "live");
        expect(html).toContain("VIDEO UNAVAILABLE");
        expect(html).toContain("Video stream is unavailable.");
        expect(html).toContain("Use iframe streaming");
        expect(html).toContain(
          'href="https://solz.fun/watch/live/agent-arena"',
        );
        expect(html).not.toContain('title="SOLZ agent arena livestream"');
        expect(html).toContain('aria-pressed="false">Iframe</button>');
        expect(html).toContain('aria-pressed="true">Video</button>');
        if (state === "intermission") expect(html).toContain("MATCH COMPLETE");
      }
    });
  }

  test("keeps empty prediction and market panels mounted when the prediction feed is unavailable", async () => {
    const source = createSolzDataSource();
    const snapshot = await source.load();
    const match = snapshot.matches.find(
      (item) => item.id === snapshot.highlightMatchId,
    )!;
    const market = snapshot.markets.find((item) => item.matchId === match.id)!;
    const html = renderToStaticMarkup(
      <MatchViewer
        match={match}
        market={market}
        markets={[]}
        snapshot={snapshot}
        source={source}
        view="options"
        onView={() => {}}
        outcome={market.outcomes[0]}
        onSelect={() => {}}
        liveHref="https://solz.fun/watch/live/agent-arena"
        onChat={() => {}}
        onPrompt={() => {}}
        season={false}
        simulation={false}
      />,
    );
    expect(html).toContain("Predictions <span>0</span>");
    expect(html).toContain("No prediction questions yet.");
    expect(html).toContain("No match market yet.");
    expect(html).toContain("Use iframe streaming");
    expect(html).not.toContain(
      'src="https://solz.fun/watch/live/agent-arena?back=false"',
    );
  });

  test("shows the reserved next match and all twelve entrants without starting the arena iframe", async () => {
    const source = createSolzDataSource();
    const snapshot = await source.load();
    const original = snapshot.matches.find(
      (item) => item.id === snapshot.highlightMatchId,
    )!;
    const match = {
      ...original,
      id: "arena-cab581e3-5e79-4251-9756-b9350ed87e22",
      phase: "countdown" as const,
      roster: snapshot.agents.slice(0, 12).map((agent, index) => ({
        ...original.roster[index % original.roster.length]!,
        agentId: agent.id,
        codename: agent.codename,
      })),
    };
    const market = snapshot.markets.find(
      (item) => item.matchId === original.id,
    )!;
    const html = renderToStaticMarkup(
      <MatchViewer
        match={match}
        market={market}
        markets={[market]}
        snapshot={snapshot}
        source={source}
        view="live"
        onView={() => {}}
        outcome={market.outcomes[0]}
        onSelect={() => {}}
        liveHref="https://solz.fun/watch/live/agent-arena?room=current"
        onChat={() => {}}
        onPrompt={() => {}}
        season={false}
        simulation={false}
      />,
    );
    expect(html).toContain("BREAK TIME");
    expect(html).toContain("Preparing match <b>#A-CAB5</b>");
    expect(html).toContain("TIME LEFT");
    expect(html).toContain("LEFT");
    expect(html).not.toContain("STARTS IN");
    expect(html).toContain("12 / 12 AGENTS CONFIRMED");
    expect(html).toContain("Use iframe streaming");
    expect(html).not.toContain(
      'src="https://solz.fun/watch/live/agent-arena?room=current&amp;back=false"',
    );
    for (const agent of snapshot.agents.slice(0, 12))
      expect(html).toContain(agent.codename.replace("&", "&amp;"));
  });

  test("leads the UP NEXT rail with the live match and its identity", async () => {
    const source = createSolzDataSource();
    const snapshot = await source.load();
    const original = snapshot.matches.find(
      (item) => item.id === snapshot.highlightMatchId,
    )!;
    const live = {
      ...original,
      displayMatchId: "GM-DM_DR-20_ID-ABC",
      matchNumber: 42,
      startedAt: 1_000,
      endsAt: 1_201_000,
      phase: "live" as const,
    };
    const html = renderToStaticMarkup(
      <NextMatches
        snapshot={{ ...snapshot, matches: [live, ...snapshot.matches.filter((item) => item.id !== live.id)] }}
        schedule={[]}
        eventBasePath="/events"
        highlight={live}
        season={false}
        matchIdCopied={false}
        onCopyMatchId={() => {}}
      />,
    );
    const leading = html.slice(0, html.indexOf("UP NEXT"));
    // The header row is gone, so the rail is the only place the match names
    // itself. Its leading card has to carry that, not just the matchup.
    expect(leading).toContain("LIVE MATCH");
    expect(leading).toContain("MATCH #42");
    expect(leading).toContain("SEASON 01");
    expect(leading).toContain("Copy match ID");
    // And the leading card must not be repeated as an upcoming one.
    expect(html.indexOf("MATCH #42")).toBe(html.lastIndexOf("MATCH #42"));
    // Five cards, no more: the rail is a fixed row, not a scroller.
    expect([...html.matchAll(/class="sh-next-match[ "]/g)].length).toBe(5);
  });

  test("keeps the stage prompt and chat corners to the livestream tab", async () => {
    const source = createSolzDataSource();
    const snapshot = await source.load();
    const match = snapshot.matches.find(
      (item) => item.id === snapshot.highlightMatchId,
    )!;
    const market = snapshot.markets.find((item) => item.matchId === match.id)!;
    const render = (view: "live" | "market" | "options", chatOpen: boolean) =>
      renderToStaticMarkup(
        <MatchViewer
          match={match}
          market={market}
          markets={[market]}
          snapshot={snapshot}
          source={source}
          view={view}
          onView={() => {}}
          outcome={market.outcomes[0]}
          onSelect={() => {}}
          liveHref="https://solz.fun/watch/live/agent-arena"
          onChat={() => {}}
          onPrompt={() => {}}
          chatOpen={chatOpen}
          onChatClose={() => {}}
          season={false}
        />,
      );

    // Both corners live inside the livestream panel, so leaving that tab hides
    // them with the panel rather than needing their own visibility rule.
    const live = render("live", true);
    const liveHidden = live.slice(live.indexOf('id="highlight-view-live-panel"'));
    expect(liveHidden).toContain("ch-stage-corner--prompt");
    expect(liveHidden).toContain("ch-stage-corner--chat");
    expect(live).toContain("PROMPT AGENT");

    // The chat field is not there until the CHAT HIGHLIGHTS rail asks for it.
    expect(render("live", false)).not.toContain("ch-stage-corner--chat");

    for (const view of ["market", "options"] as const) {
      const panel = render(view, true).match(
        /<div[^>]*id="highlight-view-live-panel"[^>]*>/,
      )?.[0];
      expect(panel).toContain("hidden");
    }
  });

  test("opens Trade and Agent Trader together and leaves chat and prompt to the stage", async () => {
    const source = createSolzDataSource();
    const snapshot = await source.load();
    const match = snapshot.matches.find(
      (item) => item.id === snapshot.highlightMatchId,
    )!;
    const market = snapshot.markets.find((item) => item.matchId === match.id)!;
    const html = renderToStaticMarkup(
      <InteractionConsole
        source={source}
        snapshot={snapshot}
        match={match}
        market={market}
        outcome={market.outcomes[0]}
        onOutcome={() => {}}
        collateralSymbol="COOLA"
        sections={["trade", "automate"]}
        onSections={() => {}}
        hideChat
        hidePrompt
        intermission={false}
      />,
    );
    const expanded = (name: string) =>
      html
        .match(new RegExp(`<button[^>]*id="console-${name}-button"[^>]*>`))?.[0]
        ?.includes('aria-expanded="true"');

    // The rail is a list of open panels now, not one exclusive key, because the
    // homepage needs both of these expanded at once.
    expect(expanded("trade")).toBe(true);
    expect(expanded("automate")).toBe(true);
    // Live chat and Prompt Agent moved to the stage corners.
    expect(html).not.toContain("console-chat-button");
    expect(html).not.toContain("console-prompt-button");
  });

  test("keeps the event page rail single-open through the list contract", async () => {
    const source = createSolzDataSource();
    const snapshot = await source.load();
    const match = snapshot.matches.find(
      (item) => item.id === snapshot.highlightMatchId,
    )!;
    const market = snapshot.markets.find((item) => item.matchId === match.id)!;
    // What EventApp passes: at most one entry, so at most one panel is open and
    // every other panel is still rendered.
    const html = renderToStaticMarkup(
      <InteractionConsole
        source={source}
        snapshot={snapshot}
        match={match}
        market={market}
        outcome={market.outcomes[0]}
        onOutcome={() => {}}
        collateralSymbol="COOLA"
        sections={["trade"]}
        onSections={() => {}}
        intermission={false}
      />,
    );
    for (const [name, open] of [
      ["trade", true],
      ["automate", false],
      ["chat", false],
      ["prompt", false],
    ] as const)
      expect(
        html
          .match(new RegExp(`<button[^>]*id="console-${name}-button"[^>]*>`))?.[0]
          ?.includes('aria-expanded="true"'),
      ).toBe(open);
  });

  test("never reuses simulation history for an unbound on-chain source", async () => {
    const source = createSolzDataSource();
    const snapshot = await source.load();
    const priced = snapshot.markets.find((market) =>
      market.outcomes.some((outcome) => outcome.priceHistory?.length),
    )!;
    const [empty] = unpricedMarkets([priced]);
    expect(empty.volume.COOLA).toBe(0);
    expect(
      empty.outcomes.every(
        (outcome) =>
          outcome.probability === 0.5 && outcome.priceHistory?.length === 0,
      ),
    ).toBe(true);
  });

  test("shows one match market containing all twelve agent winner questions without fake prices", async () => {
    const source = createSolzDataSource();
    const snapshot = await source.load();
    const match = snapshot.matches.find(
      (item) => item.id === snapshot.highlightMatchId,
    )!;
    const template = snapshot.markets.find(
      (item) => item.matchId === match.id,
    )!;
    const markets = Array.from({ length: 12 }, (_, index) => ({
      ...template,
      id: `winner-${index + 1}`,
      kind: "match-winner" as const,
      title: `Will AGENT ${index + 1} win?`,
      outcomes: template.outcomes.map((item) => ({
        ...item,
        id: item === template.outcomes[0] ? "yes" : "no",
        priceHistory: [],
      })),
      volume: { SOL: 0, COOLA: 0 },
    }));
    const independent = {
      ...template,
      id: "first-to-twelve-kills",
      kind: "kill-total" as const,
      title: "First to 12 kills?",
      outcomes: template.outcomes.map((item) => ({
        ...item,
        priceHistory: [],
      })),
      volume: { SOL: 0, COOLA: 0 },
    };
    const allMarkets = [...markets, independent];
    const html = renderToStaticMarkup(
      <MatchViewer
        match={match}
        market={markets[0]}
        markets={allMarkets}
        snapshot={snapshot}
        source={source}
        view="market"
        onView={() => {}}
        outcome={markets[0].outcomes[0]}
        onSelect={() => {}}
        liveHref="https://solz.fun/watch/live/agent-arena"
        onChat={() => {}}
        onPrompt={() => {}}
        season={false}
        simulation={false}
      />,
    );
    expect(html).toContain("Match winner · all 12 agents");
    for (let index = 1; index <= 12; index += 1)
      expect(html).toContain(`AGENT ${index}`);
    // The chart states what it has, not what it has looked for. "No trades"
    // asserted a fact about books the old component had never read; the reader
    // only needs to know there is no history and what makes that stop.
    // Reached only when the market has neither trades nor a sampled book — the
    // chart falls back to live quotes before it gives up.
    expect(html).toContain("No price recorded yet.");
    expect(html).toContain("AWAITING PRICES");
    expect(html).not.toContain("REFERENCE SAMPLE");
    expect(html).toContain("Predictions <span>13</span>");
    const marketPanel = html.slice(
      html.indexOf('id="highlight-view-market-panel"'),
      html.indexOf('id="highlight-view-options-panel"'),
    );
    expect(marketPanel).not.toContain("First to 12 kills?");
  });
});
