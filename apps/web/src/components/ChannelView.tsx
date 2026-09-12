import { mentionedHandles } from "@t3tools/client-runtime/channel-mentions";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentChannelShell } from "@t3tools/client-runtime/state/shell";
import type { ChannelId, EnvironmentId } from "@t3tools/contracts";
import { ArchiveIcon, HashIcon, SendIcon } from "lucide-react";
import { useState } from "react";

import { useChannel, useEnvironmentSupportsChannels } from "../state/entities";
import {
  canSendChannelPost,
  resolveChannelComposerState,
  resolveChannelViewState,
  type ChannelViewState,
} from "./ChannelView.logic";
import { useEnvironmentSettings } from "../hooks/useSettings";
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
 * The posts are not here yet — the server has no read for them, only the
 * membership-filtered shell. The region says so in words rather than rendering
 * an empty list, because an empty list is what a channel with no posts looks
 * like and the two are different facts. A reader who cannot tell them apart
 * concludes the channel is quiet when it is actually unreadable.
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
    serverSupportsChannels: useEnvironmentSupportsChannels(environmentId),
  });

  if (channel === null) {
    return <ChannelUnavailable state={state} />;
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <ChannelHeader channel={channel} />
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto">
        <PostsUnavailable />
      </div>
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
        <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
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
          <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
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
      if (result._tag === "Success") {
        setBody("");
        return;
      }
      // AN INTERRUPT IS NOT A FAILURE — the three sibling call sites
      // (ChatView, GitActionsControl, ChatMarkdown) all skip it, and a
      // cancelled send that raised "Could not post" would be a lie.
      if (isAtomCommandInterrupted(result)) {
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
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Could not post to #${channel.name}`,
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        }),
      );
    });
  };

  return (
    <div className="border-t border-border p-3">
      <div className="flex items-end gap-2">
        <Textarea
          size="sm"
          // CAPPED, like the thread composer's editor. The primitive is
          // `field-sizing-content` with no max-height, and it is a flex sibling
          // of the `flex-1` message region — so at 390px a long draft grew the
          // control to 89% of the pane, squeezed the region to 39px, and pushed
          // the explanation's title outside the viewport entirely. This is the
          // only composer in the app that lacked the cap.
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
