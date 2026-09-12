import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { mentionedHandles } from "@t3tools/client-runtime/channel-mentions";
import type { EnvironmentChannelShell } from "@t3tools/client-runtime/state/shell";
import type { ChannelId, EnvironmentId, OrchestrationChannelPost } from "@t3tools/contracts";
import { ArchiveIcon, HashIcon, SendIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useChannel, useChannelSupport } from "../state/entities";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";

import {
  canSendChannelPost,
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
 * THREE STATES FOR THE POST REGION, and they are three different facts: posts
 * this server cannot be asked for, a channel that genuinely has none, and a
 * list. An empty list looks exactly like the first two, so a reader who cannot
 * tell them apart concludes a channel is quiet when it is unreadable.
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
      <ChannelPostRegion channel={channel} />
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
      <span className="ms-auto shrink-0 text-xs text-muted-foreground tabular-nums">
        {channel.latestPostAt === null
          ? "No posts yet"
          : `Last post ${formatDayAwareTimestamp(channel.latestPostAt, settings.timestampFormat)}`}
      </span>
    </WorkspacePageHeader>
  );
}

/**
 * A channel's posts: the newest page on open, older pages upward on request.
 *
 * ANCHORED AT THE BOTTOM, which is what `justify-end` in the scroll container
 * does for a list shorter than the viewport and what the effect below does once
 * it is longer. A channel opens at its newest post because that is where a
 * reader wants to be, and it is the one scroll position that does not need
 * restoring.
 *
 * PAGING IS A CONTROL, NOT A SCROLL HANDLER, for now. A scroll-triggered fetch
 * fires repeatedly while the momentum of one flick carries the container past
 * the threshold, and guarding that needs the request to be in flight before the
 * next event arrives — which the atom family does not expose. A button asks once
 * and says what it is doing. `t3_bot-ajw` carries the scroll refinement.
 *
 * THE CURSOR IS OPAQUE HERE TOO. This component holds whatever `nextCursor` the
 * server last gave it and hands it back verbatim; it never builds one, which is
 * the property `decodeChannelCursor` refuses to let a caller break.
 */
/**
 * How many posts a page asks for.
 *
 * WELL UNDER `CHANNEL_POST_PAGE_LIMIT_MAX`, which is the server's ceiling and
 * not a target: this is the number that fills a tall pane once with room to
 * scroll, so opening a channel is one request rather than two.
 */
const CHANNEL_POST_PAGE_SIZE = 50;

function ChannelPostRegion({ channel }: { readonly channel: EnvironmentChannelShell }) {
  const { environmentId, id: channelId } = channel;
  // The cursor this region is currently asking with. `undefined` is the newest
  // page, which is what opening a channel wants.
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [posts, setPosts] = useState<ReadonlyArray<OrchestrationChannelPost>>([]);
  const [reachedStart, setReachedStart] = useState(false);
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

  const arrived = Option.getOrUndefined(AsyncResult.value(page));

  // LIVE ARRIVAL, from the shell rather than from a per-post event.
  //
  // There is no per-post event to subscribe to, and that is a property of the
  // stream rather than a gap: the shell coalescer keeps only the LATEST event
  // per aggregate per 50ms window, which is the whole reason `latestPostAt` is
  // on the channel shell. Two posts inside one window arrive as ONE event
  // carrying the newer timestamp, so the event cannot carry a post and the
  // client has to re-read.
  //
  // Only when the channel is showing its newest page. A reader who has paged
  // upward is holding an older cursor, and re-reading under it would answer
  // with the same old page while the new post sat unread below them; the next
  // return to the bottom picks it up.
  useEffect(() => {
    if (cursor === undefined) {
      refresh();
    }
  }, [channel.latestPostAt, cursor, refresh]);

  useEffect(() => {
    if (arrived === undefined) {
      return;
    }
    setPosts((existing) => mergeChannelPosts({ existing, incoming: arrived.posts }));
    if (arrived.nextCursor === null) {
      setReachedStart(true);
    }
  }, [arrived]);

  // ANCHORED ON THE NEWEST POST, not on every merge. Scrolling to the bottom
  // when an OLDER page arrives would throw the reader back to the present the
  // moment they paged up, which is the one thing paging upward must not do.
  const newestId = posts[posts.length - 1]?.id;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [newestId]);

  if (AsyncResult.isFailure(page) && posts.length === 0) {
    return <PostsUnavailable />;
  }
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
    <div className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto">
      <div className="flex flex-col gap-3 p-4">
        {reachedStart ? null : (
          <Button
            variant="ghost"
            size="sm"
            className="self-center"
            disabled={page.waiting}
            onClick={() => {
              const next = arrived?.nextCursor;
              if (next !== null && next !== undefined) {
                setCursor(next);
              }
            }}
          >
            {page.waiting ? "Loading earlier posts…" : "Earlier posts"}
          </Button>
        )}
        {posts.map((post) => (
          <ChannelPost key={post.id} environmentId={environmentId} post={post} />
        ))}
        <div ref={bottom} />
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
      */}
      <p className="whitespace-pre-wrap text-sm text-foreground">{post.body}</p>
    </article>
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
 * Deliberately not an empty list and not a spinner: nothing is loading, the
 * read does not exist. A spinner here would be the lying spinner this repo
 * names as a defect — it would keep claiming progress forever.
 */
function PostsUnavailable() {
  return (
    <Empty className="flex-1">
      <EmptyHeader className="max-w-md">
        {/*
          No size override: `EmptyTitle` is `text-xl`, and forcing `text-base`
          gave a 16/14 step over the body text — 1.14:1, under the 1.25:1
          minimum for adjacent type levels. Every other full-pane empty state in
          the app keeps or raises the primitive's size.
        */}
        <EmptyTitle className="text-foreground">Posts aren’t readable yet</EmptyTitle>
        {/*
          No opacity modifier: `/78` measured 3.11:1 in light and 3.51:1 in
          dark, and `EmptyDescription`'s own `text-muted-foreground` measures
          4.71:1 and 5.08:1 on the same ground. Every AA failure in this
          component was an opacity modifier I added to an already-muted token.
        */}
        <EmptyDescription className="mt-2 text-sm">
          This server sends the channels you are in, but not yet their posts. You can post here and
          the channel’s last-post time will update; reading the history needs a newer server.
        </EmptyDescription>
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
