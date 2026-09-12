import { mentionedHandles } from "@t3tools/client-runtime/channel-mentions";
import type { EnvironmentChannelShell } from "@t3tools/client-runtime/state/shell";
import type { ChannelId, EnvironmentId } from "@t3tools/contracts";
import { ArchiveIcon, HashIcon, SendIcon } from "lucide-react";
import { useState } from "react";

import { useChannel, useEnvironmentSupportsChannels } from "../state/entities";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { channelEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { formatDayAwareTimestamp } from "../timestampFormat";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { Textarea } from "./ui/textarea";
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
  const serverHasChannels = useEnvironmentSupportsChannels(environmentId);

  if (channel === null) {
    return <ChannelUnavailable serverHasChannels={serverHasChannels} />;
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
      <span className="ms-auto shrink-0 text-xs text-muted-foreground/78">
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
        <EmptyTitle className="text-base text-foreground">Posts aren’t readable yet</EmptyTitle>
        <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
          This server sends the channels you are in, but not yet their posts. You can post here and
          the channel’s last-post time will update; reading the history needs a newer server.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function ChannelUnavailable({ serverHasChannels }: { readonly serverHasChannels: boolean }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle className="text-base text-foreground">
            {serverHasChannels ? "This channel isn’t available" : "This server has no channels"}
          </EmptyTitle>
          {/*
            Two different facts, and the distinction is why
            `environmentSupportsChannels` exists separately from the list. A
            server that predates channels cannot be fixed by being added to one;
            a channel you are not in can. Telling an operator to ask for an
            invite to a server that has no channels wastes their time and hides
            the real problem, which is the server version.
          */}
          <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
            {serverHasChannels
              ? "It may have been removed, or you may not be a member. The server only sends the channels you belong to."
              : "Channels come from the server. Update the server on that machine to use them."}
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
  const archived = channel.archivedAt !== null;
  // The decider refuses a post to an archived channel, so offering a composer
  // there would be offering an action that cannot succeed.
  if (archived) {
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
  const canSend = trimmed.length > 0 && !sending;
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
      // The draft survives a refusal. An unresolvable mention fails the whole
      // post, and clearing the box on failure would lose what the operator
      // typed with no way to get it back.
      if (result._tag === "Success") {
        setBody("");
      }
    });
  };

  return (
    <div className="border-t border-border p-3">
      <div className="flex items-end gap-2">
        <Textarea
          size="sm"
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
