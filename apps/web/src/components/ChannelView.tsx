import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { mentionedHandles } from "@t3tools/client-runtime/channel-mentions";
import type { EnvironmentChannelShell } from "@t3tools/client-runtime/state/shell";
import type {
  ChannelId,
  EnvironmentId,
  OrchestrationChannelPost,
  ThreadId,
} from "@t3tools/contracts";
import { ArchiveIcon, HashIcon, SendIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useChannel, useChannelSupport, useThreadShell } from "../state/entities";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";

import {
  canSendChannelPost,
  describeChannelPostWakes,
  mergeChannelPosts,
  resolveChannelComposerState,
  resolveChannelViewState,
  resolveSendOutcome,
  type ChannelViewState,
} from "./ChannelView.logic";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { orchestrationEnvironment } from "../state/orchestration";
import { channelEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { formatDayAwareTimestamp } from "../timestampFormat";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { Textarea } from "./ui/textarea";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

/**
 * One channel: its header, its posts, and the composer.
 *
 * FOUR STATES FOR THE POST REGION, and they are four different facts: posts this
 * server cannot be asked for, a channel that genuinely has none, a list, and — the
 * one a reader meets first on every open — a read that has not answered yet. An
 * empty list looks exactly like the first two, so a reader who cannot tell them
 * apart concludes a channel is quiet when it is unreadable.
 *
 * The fourth renders an empty pane and says nothing, which is deliberate and is the
 * same choice `state === "loading"` makes below: nothing here is slow, the answer
 * simply has not arrived, and both a spinner and the pager's own "Loading earlier
 * posts…" would be claims about it. That label in particular was the defect — it
 * rendered over an empty pane, where nothing is earlier than anything.
 *
 * `PostsUnavailable` therefore stays rather than being deleted. A server that
 * predates `orchestration.readChannelPosts` still sends the channel shell, so
 * the channel opens and only its history is missing — the way out of a one-way
 * door this repository asks for.
 */
export function ChannelView({
  environmentId,
  channelId,
}: {
  readonly environmentId: EnvironmentId;
  readonly channelId: ChannelId;
}) {
  const channel = useChannel({ environmentId, channelId });
  const state = resolveChannelViewState({
    channelExists: channel !== null,
    support: useChannelSupport(environmentId),
  });

  // NOTHING, not a spinner, and not a guess about the server. This is the
  // thread route's own behaviour while its shell is in flight
  // (`_chat.$environmentId.$threadId.tsx` renders null), and a spinner would be
  // the lying spinner this repo names as a defect — nothing here is slow, the
  // snapshot simply has not landed. Saying "this server has no channels" for
  // these few frames is what this state exists to stop.
  if (state === "loading") {
    return null;
  }
  if (channel === null) {
    return <ChannelUnavailable state={state} />;
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <ChannelHeader channel={channel} />
      {/*
        KEYED ON THE CHANNEL, because this region holds `cursor`, `posts` and
        `moreAbove` in state and the route renders it with no key and no
        `remountDeps` — so switching `$channelId` keeps the same fiber. Measured
        before this key existed: channel A's posts rendered under channel B's
        header, A's paging state suppressed B's "Earlier posts", and B was asked
        with A's cursor, which the server refuses and nothing reports.

        A key rather than an effect that clears the three. An effect runs AFTER
        the first render of the new channel, so the wrong posts paint for a frame
        and the wrong cursor is already in flight.
      */}
      <ChannelPostRegion key={channel.id} channel={channel} />
      <ChannelComposer channel={channel} />
    </div>
  );
}

function ChannelHeader({ channel }: { readonly channel: EnvironmentChannelShell }) {
  const settings = useEnvironmentSettings(channel.environmentId);
  const archived = channel.archivedAt !== null;
  return (
    <WorkspacePageHeader className="border-b border-border">
      <div className="flex min-w-0 items-center gap-2">
        {archived ? (
          <ArchiveIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <HashIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="truncate text-sm font-medium text-foreground">{channel.name}</span>
        {archived ? (
          <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
            Archived
          </span>
        ) : null}
      </div>
      {/*
        The last post's time, because it is the one live fact this client holds
        about the channel's contents while the posts themselves are unreadable —
        and it is what the sidebar orders by, so seeing it move here is how an
        operator confirms their own post landed.
      */}
      {/*
        `text-muted-foreground` at full opacity, matching the thread timeline's
        timestamp. The /78 modifier measured 3.11:1 light and 3.51:1 dark; the
        same token at full opacity on the same ground measures 4.71:1 and 5.08:1.
        An opacity modifier on a muted token is where this palette fails AA.
      */}
      {/*
        NOTHING WHEN THERE IS NO LAST POST, rather than "No posts yet". The pane
        directly below says "No posts yet. Say something to start the channel.",
        so this slot was rendering the same sentence a second time about 60px
        above it — measured as two nodes carrying that text in all four
        viewport/theme combinations, which reads as a repeated element rather
        than as two facts. This slot answers WHEN the last post was; on a channel
        with no posts there is no such time, and the pane owns the sentence.
      */}
      {channel.latestPostAt === null ? null : (
        <span className="ms-auto shrink-0 text-xs text-muted-foreground tabular-nums">
          {`Last post ${formatDayAwareTimestamp(channel.latestPostAt, settings.timestampFormat)}`}
        </span>
      )}
    </WorkspacePageHeader>
  );
}

/**
 * How many posts a page asks for.
 *
 * WELL UNDER `CHANNEL_POST_PAGE_LIMIT_MAX`, which is the server's ceiling and
 * not a target: this is the number that fills a tall pane once with room to
 * scroll, so opening a channel is one request rather than two.
 *
 * NOT THE AGENT TOOL'S DEFAULT, which is also 50 (`DEFAULT_READ_LIMIT` in the comms
 * toolkit). That one is how much history an agent reads without asking; this is what
 * fills a tall pane once. They are not shared on purpose — coupling them would let a
 * change to this layout silently change what every agent reads.
 *
 * A FIXTURE THAT MEANS TO EXERCISE PAGING NEEDS MORE POSTS THAN THIS. A channel
 * holding exactly this many is answered with one full page and `nextCursor:
 * null`, so `moreAbove` is false and the pager never renders — a render pass
 * seeded with fifty posts measured the scrolling and reported on a control that
 * was not on the screen. Seed at least this many plus one.
 */
const CHANNEL_POST_PAGE_SIZE = 50;

/**
 * A channel's posts: the newest page on open, older pages upward on request.
 *
 * ANCHORED AT THE BOTTOM by `mt-auto` on the inner wrapper for a short list, and
 * by the effect below once the list is taller than the pane. It used to say
 * `justify-end` did the first half, and that was the p0: `justify-end` also made
 * the overflow unscrollable, so the second half never got a chance to run. A
 * channel opens at its newest post because that is where a reader wants to be,
 * and it is the one scroll position that does not need restoring.
 *
 * PAGING IS A CONTROL, NOT A SCROLL HANDLER, for now. A scroll-triggered fetch
 * fires repeatedly while the momentum of one flick carries the container past
 * the threshold, and the guard cannot be `page.waiting`: it is state, so it changes on
 * re-render, and every scroll event inside one frame reads the value from before the
 * dispatch. A ref that flips synchronously where the fetch is dispatched is what
 * that needs — three lines, and none of them are missing from the atom family, which
 * does report in-flight reads and is what disables this button. A button asks once
 * and says what it is doing.
 *
 * `t3_bot-ef1` carries the scroll refinement, NOT `t3_bot-ajw`: ajw is the bead this
 * work closes, so a deferral parked on it would have been closed along with it.
 *
 * THE CURSOR IS OPAQUE HERE TOO. This component holds whatever `nextCursor` the
 * server last gave it and hands it back verbatim; it never builds one, which is
 * the property `decodeChannelCursor` refuses to let a caller break.
 */
function ChannelPostRegion({ channel }: { readonly channel: EnvironmentChannelShell }) {
  const { environmentId, id: channelId } = channel;
  // The cursor this region is currently asking with. `undefined` is the newest
  // page, which is what opening a channel wants.
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [posts, setPosts] = useState<ReadonlyArray<OrchestrationChannelPost>>([]);
  // The newest post this region has already asked about. NOT a "have I mounted"
  // flag: what the refresh below must not do is re-read a value it has already
  // seen, and that is equally true of the second render and of a re-render caused
  // by something else entirely.
  const readThrough = useRef(channel.latestPostAt);
  // THREE FACTS IN ONE VARIABLE, because they are three answers to one question
  // and the fourth combination does not exist: `undefined` is "no page has
  // arrived yet", `true` is "a page arrived and there is more above it", `false`
  // is "a page arrived and it reached the beginning of history".
  //
  // A separate boolean starting `false` admitted that fourth combination, and it
  // was reachable on every open: the pager rendered before any page landed, over
  // an empty pane, and clicking it did nothing because there was no cursor yet.
  //
  // NOT A LATCH, and the input that distinguishes the two is a channel whose whole
  // history fits one page: it answers `nextCursor: null`, and when the next post
  // arrives the re-read's page is full and carries a cursor again. A latch would
  // have hidden the pager on that channel for the rest of the session.
  const [moreAbove, setMoreAbove] = useState<boolean | undefined>(undefined);
  const bottom = useRef<HTMLDivElement | null>(null);

  const request = orchestrationEnvironment.channelPosts({
    environmentId,
    input: {
      channelId,
      direction: "backward",
      limit: CHANNEL_POST_PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    },
  });
  const page = useAtomValue(request);
  const refresh = useAtomRefresh(request);

  // THE NEWEST PAGE STAYS MOUNTED WHILE THE READER PAGES UP. It is the same atom as
  // `request` until the first "Earlier posts" click, and after it the one the live
  // arrival below keeps re-reading. Unmounting it was what killed live arrival for
  // the rest of the instance: `setCursor` has one caller and nothing clears it.
  //
  // Clearing the cursor to "return" was the alternative, and it has two holes the
  // atom's cache policy makes: `Atom.swr` re-reads on a remount only past its
  // `staleTime`, so within it the effect would have to force the read, and past it
  // the remount and the effect would BOTH read — the open-ran-twice defect the effect
  // comment below was written to keep out. And the pager would then walk history the
  // region already holds. Keeping the atom mounted costs one subscription and no read.
  const newestRequest = orchestrationEnvironment.channelPosts({
    environmentId,
    input: { channelId, direction: "backward", limit: CHANNEL_POST_PAGE_SIZE },
  });
  const newestPage = useAtomValue(newestRequest);
  const refreshNewest = useAtomRefresh(newestRequest);

  const arrived = Option.getOrUndefined(AsyncResult.value(page));
  const newestArrived = Option.getOrUndefined(AsyncResult.value(newestPage));

  // LIVE ARRIVAL, from the shell rather than from a per-post event.
  //
  // There is no per-post event to subscribe to, and that is a property of the
  // stream rather than a gap: the shell coalescer keeps only the LATEST event
  // per aggregate per 50ms window, which is the whole reason `latestPostAt` is
  // on the channel shell. Two posts inside one window arrive as ONE event
  // carrying the newer timestamp, so the event cannot carry a post and the
  // client has to re-read.
  //
  // ALWAYS THE NEWEST PAGE, whatever the pager is holding. This used to return
  // early while the reader was paged up, with a comment saying "the next return
  // to the bottom picks it up" — and there was no return to the bottom in the
  // code, so one click on "Earlier posts" ended live arrival for good. The input
  // that distinguishes: a `latestPostAt` change AFTER a page-up must still be
  // answered with a read of the newest page.
  //
  // AND ONLY ON A CHANGE. On the FIRST commit the atom is already fetching, because
  // every query here goes through `Atom.swr({ revalidateOnMount: true })` and a manual
  // refresh is forceful and always forwarded. Firing here on mount ran every channel
  // open TWICE and pulled up to two pages over the socket, on the most frequent
  // interaction in the feature.
  useEffect(() => {
    if (readThrough.current === channel.latestPostAt) {
      return;
    }
    readThrough.current = channel.latestPostAt;
    refreshNewest();
  }, [channel.latestPostAt, refreshNewest]);

  // DEPENDS ON `arrived` BY REFERENCE, which is only safe because the atom
  // memoises its value. A component test that handed back a fresh page object per
  // render looped here until the worker ran out of memory: this effect calls
  // `setPosts`, which re-renders, which would produce another new page. If this
  // ever reads from something that rebuilds its value per render, compare by
  // content or key on the ids.
  useEffect(() => {
    if (arrived === undefined) {
      return;
    }
    setPosts((existing) => mergeChannelPosts({ existing, incoming: arrived.posts }));
    setMoreAbove(arrived.nextCursor !== null);
  }, [arrived]);
  // The newest page merges too, and says nothing about `moreAbove`: while the
  // reader is paged up, "is there more above" is the PAGER's page's answer, and
  // the newest page's cursor points at history the region already holds.
  useEffect(() => {
    if (newestArrived === undefined) {
      return;
    }
    setPosts((existing) => mergeChannelPosts({ existing, incoming: newestArrived.posts }));
  }, [newestArrived]);

  // ANCHORED ON THE NEWEST POST, not on every merge. Scrolling to the bottom
  // when an OLDER page arrives would throw the reader back to the present the
  // moment they paged up, which is the one thing paging upward must not do.
  //
  // AND NOT WHILE THE READER IS UP IN HISTORY. With live arrival no longer gated on
  // the cursor, a new post can land while they are reading an older page, and
  // scrolling them to it is the same theft as scrolling on an older page. The
  // cursor is the proxy for "up in history" — there is no scroll handler yet
  // (`t3_bot-cdo`) — so a reader who paged up and scrolled back down is offered the
  // control instead of the jump; the control is one click and the jump is a theft.
  //
  // A LAYOUT EFFECT, so the scroll and the "seen" mark land before the paint. With a
  // passive effect the frame between commit and effect shows the newest post
  // unscrolled and the "New posts" control lit for a reader who is on the newest
  // page — one frame, on every post, which is the flicker this app's users notice.
  const newestId = posts[posts.length - 1]?.id;
  const [seenNewestId, setSeenNewestId] = useState<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (cursor !== undefined) {
      return;
    }
    bottom.current?.scrollIntoView({ block: "end" });
    setSeenNewestId(newestId);
  }, [cursor, newestId]);
  // Not gated on the cursor a second time: on the newest page the effect above marks
  // every newest post seen before paint, so the id comparison alone is the fact.
  const unseenBelow = newestId !== undefined && newestId !== seenNewestId;

  if (AsyncResult.isFailure(page) && posts.length === 0) {
    return <PostsUnavailable onRetry={refresh} />;
  }
  // A FAILURE WITH POSTS ALREADY ON SCREEN IS NOT THE SAME STATE, and it used to be
  // reported as nothing at all: the guard above only fires while the channel has shown
  // nothing, so a page that failed after one had landed rendered the previous screen
  // unchanged. No error, and the pager back to "Earlier posts" as though ready —
  // pressing it did nothing, because `arrived` is undefined over a Failure. Live
  // arrival had stopped too, since `cursor` is no longer undefined. A channel that
  // silently stops mid-history with a control that lies about being able to continue.
  const pageFailed = AsyncResult.isFailure(page);
  // RETURNED INSTEAD OF THE SCROLL CONTAINER, the way `PostsUnavailable` is.
  // Found by rendering twice: inside that container the empty state cannot
  // centre, because `justify-end` is what puts posts above the composer and
  // `flex-1` on a child of the inner wrapper has nothing to stretch against. It
  // first arrived pinned to the composer, then 100px higher, and neither read as
  // an empty state. The container is right for posts and wrong for this.
  if (posts.length === 0 && !page.waiting) {
    return <NoPostsYet />;
  }

  return (
    // `mt-auto` ON THE WRAPPER, NOT `justify-end` ON THE SCROLLER, and the
    // difference is whether the list can be scrolled at all.
    //
    // `justify-content: flex-end` makes content taller than the container spill
    // past its block-START edge, and block-start overflow is NOT part of the
    // scrollable overflow region — so the browser reports no scrollable range and
    // every post above the fold is rendered and permanently unreachable.
    // Measured on the live element: with `flex-end`, `scrollHeight === clientHeight`
    // and `maxScrollTop` 0; `flex-start` on the same element, 4312 against 755.
    // In real Chrome with fifty posts, one was reachable, and forty wheel events
    // moved nothing.
    //
    // My own render pass missed it because the channel had ONE post — which fits
    // the pane, so the property could not be exercised. `mt-auto` gives the same
    // bottom alignment for a short list and leaves the overflow scrollable.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mt-auto flex flex-col gap-3 p-4">
        {moreAbove ? (
          // ONE CONTROL, whose action is what the reader needs next. On a failure it
          // re-issues the SAME cursor through `refresh()` rather than advancing or
          // resetting one: reverting to the newest page would silently undo the reader's
          // own action and throw away their place in the history.
          <Button
            variant="ghost"
            size="sm"
            className="self-center"
            disabled={page.waiting}
            onClick={() => {
              if (pageFailed) {
                refresh();
                return;
              }
              const next = arrived?.nextCursor;
              if (next !== null && next !== undefined) {
                setCursor(next);
              }
            }}
          >
            {page.waiting
              ? "Loading earlier posts…"
              : pageFailed
                ? "Earlier posts didn’t load. Try again"
                : "Earlier posts"}
          </Button>
        ) : null}
        {posts.map((post) => (
          <ChannelPost key={post.id} environmentId={environmentId} post={post} />
        ))}
        <div ref={bottom} />
        {unseenBelow ? (
          // THE WAY BACK, for a reader who paged up while the channel moved on. It
          // scrolls; it does not re-read or touch the cursor, because the posts are
          // already merged in and the pager's place in history is theirs to keep.
          // `sticky bottom-3` keeps it at the bottom edge of the scroller for as long as
          // the newest post is below the fold.
          <Button
            variant="secondary"
            size="sm"
            className="sticky bottom-3 self-center"
            onClick={() => {
              bottom.current?.scrollIntoView({ block: "end" });
              setSeenNewestId(newestId);
            }}
          >
            New posts
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** One post. The author's handle, when it landed, and the body as written. */
function ChannelPost({
  environmentId,
  post,
}: {
  readonly environmentId: EnvironmentId;
  readonly post: OrchestrationChannelPost;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const wakes = describeChannelPostWakes(post.wakes);
  return (
    <article className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium text-foreground">@{post.authorHandle}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatDayAwareTimestamp(post.createdAt, settings.timestampFormat)}
        </span>
      </div>
      {/*
        `whitespace-pre-wrap`: a post is what its author typed, and newlines are
        the only formatting the composer offers. No markdown rendering — the
        body is not trusted markup and this is not the thread view.

        `wrap-break-word` because pre-wrap PRESERVES break opportunities and does
        not create them, so a token with none in it sets the column's width. A
        180-character token and a spaceless URL took the region to `scrollWidth`
        1310 against `clientWidth` 390 at phone width, one paragraph accounting for
        936 of it: the list scrolled sideways, and a reader who went right to finish
        a URL took every other post with them. URLs, PR links, commit SHAs and bead
        ids are what this channel carries, so this is the ordinary case.

        Matching `MessagesTimeline`'s message body, which is
        `whitespace-pre-wrap wrap-break-word` for the same reason.
      */}
      <p className="whitespace-pre-wrap wrap-break-word text-sm text-foreground">{post.body}</p>
      {wakes === null ? null : (
        // ONE LINE PER WAKE, and a list rather than a sentence because the field
        // is an array: a post mentioning three handles wakes three threads, and a
        // sentence built for one stretches badly at three. `wrap-break-word` for
        // the same reason as the body — a thread title is free text.
        //
        // `gap-1`, the article's own gap, and not less: at 390px a wrapped title's
        // two lines sit 0px apart, so a smaller gap puts the next item closer than
        // one line pitch and the item boundaries vanish.
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {wakes.map((wake) => (
            <ChannelPostWakeLine
              key={wake.threadId}
              environmentId={environmentId}
              threadId={wake.threadId}
              ended={wake.ended}
            />
          ))}
        </ul>
      )}
    </article>
  );
}

/**
 * "Woke <thread>", and " · <how it ended>" once the turn has settled, as text.
 * The thread is named by its shell title while the client holds an ACTIVE shell
 * for it, and by its id otherwise. The shell snapshot carries active threads only
 * (server: `listActiveThreadRows`); archived shells come from a separate
 * `archivedShellSnapshot` read this pane does not issue. So a woken thread that
 * was later archived — or deleted — is identified by its id here. Reading the
 * archived snapshot from the pane is a payload decision, held by `t3_bot-fis`.
 *
 * NOT A LINK. The turn id behind this line is provider-shaped (see
 * `describeChannelPostWakes`), so a control here would act on a turn the reader
 * is not looking at. That alone is the reason: the line carries no navigation,
 * and the thread is in the sidebar only while this client holds an unarchived
 * shell for it in scope — the name here is not a promise that it is.
 */
function ChannelPostWakeLine({
  environmentId,
  threadId,
  ended,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly ended: string | null;
}) {
  const shell = useThreadShell({ environmentId, threadId });
  return (
    <li className="wrap-break-word">
      Woke <span className="text-foreground">{shell?.title ?? threadId}</span>
      {ended === null ? null : ` · ${ended}`}
    </li>
  );
}

/**
 * A channel that really has no posts, which is NOT `PostsUnavailable`.
 *
 * One says "nobody has written here", the other says "this server cannot tell
 * you". Rendering the same thing for both is how a reader concludes a channel is
 * quiet when its history is simply unreachable.
 */
function NoPostsYet() {
  // CENTRED, NOT `self-center` INSIDE `justify-end`. Found by rendering: the
  // first version arrived pinned just above the composer with the whole pane
  // empty above it, reading as a stray label rather than an empty state — and
  // `PostsUnavailable`, the other empty state in this same region, centres. Two
  // placements for two empty states a reader sees one at a time is the kind of
  // inconsistency only a render pass finds.
  //
  // `justify-end` on the scroll container stays: it is right for posts, which
  // grow upward from the composer.
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <p className="text-sm text-muted-foreground">
        No posts yet. Say something to start the channel.
      </p>
    </div>
  );
}

/**
 * Why there are no posts on screen, stated rather than implied.
 *
 * Deliberately not an empty list and not a spinner: a spinner here would be the lying
 * spinner this repo names as a defect, claiming progress forever over a read that has
 * already answered.
 *
 * BOTH CAUSES, because this used to name only one. The text came from `#20`, when the
 * read genuinely did not exist, and it told the operator their server was too old —
 * which is now one of several ways to get here and the only one they cannot fix by
 * retrying. A store failure, a dropped socket and a refused cursor all land on this
 * state, and "update the server on that machine" is advice that will not help them.
 */
function PostsUnavailable({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <Empty className="flex-1">
      <EmptyHeader className="max-w-md">
        {/*
          No size override: `EmptyTitle` is `text-xl`, and forcing `text-base`
          gave a 16/14 step over the body text — 1.14:1, under the 1.25:1
          minimum for adjacent type levels. Every other full-pane empty state in
          the app keeps or raises the primitive's size.
        */}
        <EmptyTitle className="text-foreground">Posts aren’t readable</EmptyTitle>
        {/*
          No opacity modifier: `/78` measured 3.11:1 in light and 3.51:1 in
          dark, and `EmptyDescription`'s own `text-muted-foreground` measures
          4.71:1 and 5.08:1 on the same ground. Every AA failure in this
          component was an opacity modifier I added to an already-muted token.
        */}
        <EmptyDescription className="mt-2 text-sm">
          This channel’s history could not be read. Trying again may work; a server that predates
          channel posts cannot send it at all, and needs updating on that machine. Either way you
          can post here, and the channel’s last-post time will update.
        </EmptyDescription>
        <Button variant="outline" size="sm" className="mt-4 self-center" onClick={onRetry}>
          Try again
        </Button>
      </EmptyHeader>
    </Empty>
  );
}

function ChannelUnavailable({ state }: { readonly state: ChannelViewState }) {
  // Two different facts, which is why `environmentSupportsChannels` exists
  // separately from the list. A server that predates channels cannot be fixed by
  // being added to one; a channel you are not in can.
  const unsupported = state === "unsupported";
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle className="text-foreground">
            {unsupported ? "This server has no channels" : "This channel isn’t available"}
          </EmptyTitle>
          <EmptyDescription className="mt-2 text-sm">
            {unsupported
              ? "Channels come from the server. Update the server on that machine to use them."
              : "It may have been removed, or you may not be a member. The server only sends the channels you belong to."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

function ChannelComposer({ channel }: { readonly channel: EnvironmentChannelShell }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const post = useAtomCommand(channelEnvironment.post);
  // The decider refuses a post to an archived channel, so offering a composer
  // there would be offering an action that cannot succeed.
  if (resolveChannelComposerState(channel) === "archived") {
    return (
      <p
        role="status"
        className="border-t border-border px-4 py-3 text-center text-xs text-muted-foreground"
      >
        This channel is archived. You can read it, but not post to it.
      </p>
    );
  }

  const trimmed = body.trim();
  const canSend = canSendChannelPost({ body, sending });
  const send = () => {
    if (!canSend) return;
    setSending(true);
    void post({
      environmentId: channel.environmentId,
      input: {
        channelId: channel.id,
        body: trimmed,
        // Parsed from the body rather than picked in a menu: an agent reading
        // this channel sees "@boss1" in the text, so the text is where the
        // mention has to be authored or the two disagree.
        mentions: mentionedHandles(trimmed),
        parentPostId: null,
      },
    }).then((result) => {
      setSending(false);
      const outcome = resolveSendOutcome(result);
      if (outcome.kind === "clear-draft") {
        setBody("");
        return;
      }
      // AN INTERRUPT IS NOT A FAILURE — the three sibling call sites
      // (ChatView, GitActionsControl, ChatMarkdown) all skip it, and a
      // cancelled send that raised "Could not post" would be a lie.
      if (outcome.kind === "ignore") {
        return;
      }
      // The draft survives a refusal, and the reason is now VISIBLE. Without
      // this branch a refused post was indistinguishable from one not yet
      // sent: the text stayed, Send re-enabled, and pressing Enter again
      // failed identically forever with only a console line to say why.
      //
      // The server's message is what the operator needs, not a generic one.
      // `requireChannelMentionsResolve` names the handles that resolved to
      // nobody, and `requireCanonicalChannelHandle` names the forbidden code
      // point as "U+200B" — both of which tell the operator what to change in
      // the text they can still see.
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Could not post to #${channel.name}`,
          description: outcome.message,
        }),
      );
    });
  };

  return (
    <div className="border-t border-border p-3">
      <div className="flex items-end gap-2">
        <Textarea
          size="sm"
          // CAPPED AT 200px. The primitive is `field-sizing-content` with no
          // max-height and it is a flex sibling of the `flex-1` message region,
          // so at 390px a thirty-line draft grew the control to 89% of the pane,
          // squeezed the region to 39px, and pushed the explanation's title
          // outside the viewport. Measured after: region 567px, control 198px,
          // scrolling internally.
          //
          // THE CAP LANDS ON THE WRAPPER, not the control. `Textarea` forwards
          // `className` to its outer span, so the `<textarea>`'s own computed
          // max-height stays `none` and it is the wrapper that bounds it. That
          // differs from `ComposerPromptEditor`, which caps the scrolling
          // element itself — the outcome matches, the mechanism does not.
          className="max-h-50"
          value={body}
          placeholder={`Message #${channel.name}`}
          aria-label={`Message #${channel.name}`}
          onChange={(event) => setBody(event.currentTarget.value)}
          onKeyDown={(event) => {
            // Enter sends and shift+enter breaks the line, matching the thread
            // composer. A channel post is a message, not a document.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
        />
        <Button size="sm" disabled={!canSend} onClick={send}>
          <SendIcon className="size-4" />
          Send
        </Button>
      </div>
    </div>
  );
}
