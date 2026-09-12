import { channelKey, type EnvironmentChannelShell } from "@t3tools/client-runtime/state/shell";
import { Link } from "@tanstack/react-router";
import { ArchiveIcon, HashIcon } from "lucide-react";

import { useChannels } from "../state/entities";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "./ui/sidebar";

/**
 * The channels this operator is a member of.
 *
 * No unread count and no bold-for-new, per the PM's ruling: the server sends no
 * per-post event and holds no read cursor, so any badge here would be counting
 * something the client invented. Recency ordering is the whole signal — a
 * channel someone just posted in rises to the top, which is the fact
 * `latestPostAt` actually carries.
 *
 * The section is absent rather than empty when the list is empty. A "Channels"
 * header over nothing reads as a broken feature on the servers that have none,
 * and there is no action to offer under it: a channel is created by the seeder
 * or by an administrator, never from this sidebar.
 */
export function SidebarChannels() {
  const channels = useChannels();
  if (channels.length === 0) {
    return null;
  }
  return (
    <div className="mb-1 flex flex-col gap-1" data-testid="sidebar-channels">
      <div className="flex items-center gap-2 px-2 text-left text-xs font-medium text-sidebar-muted-foreground/60">
        <span className="shrink-0">Channels</span>
        <span aria-hidden className="h-px min-w-2 flex-1 bg-sidebar-border/60" />
      </div>
      <SidebarMenu>
        {channels.map((channel) => (
          <SidebarChannelRow
            key={channelKey({ environmentId: channel.environmentId, channelId: channel.id })}
            channel={channel}
          />
        ))}
      </SidebarMenu>
    </div>
  );
}

function SidebarChannelRow({ channel }: { readonly channel: EnvironmentChannelShell }) {
  const archived = channel.archivedAt !== null;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={
          <Link
            to="/channels/$environmentId/$channelId"
            params={{ environmentId: channel.environmentId, channelId: channel.id }}
            // The router decides which row is the current one. Comparing the
            // channel to a route param here would need this component to know
            // how the route spells its params, and would go stale the moment the
            // route did.
            activeProps={{ "data-active": "true" }}
          />
        }
        // Archived is stated in the row rather than hiding it. A channel with
        // history an operator may need to read is not gone, and dropping it from
        // the list would leave them no way back to it.
        tooltip={archived ? `#${channel.name} (archived)` : `#${channel.name}`}
      >
        {archived ? <ArchiveIcon aria-hidden /> : <HashIcon aria-hidden />}
        {/*
          NOT DIMMED. Carrying "archived" as reduced opacity measured 2.27:1 in
          light and 3.44:1 in dark against a 4.5:1 requirement — so the one
          visual signal a sighted user had was the part that failed AA. The row
          keeps the button's own colour and says the word instead, which is what
          the channel header already does.
        */}
        <span className="truncate">{channel.name}</span>
        {archived ? (
          <span className="ms-auto shrink-0 text-xs text-sidebar-muted-foreground">archived</span>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
